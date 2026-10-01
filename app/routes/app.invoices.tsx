import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useOutlet } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, IndexTable, TextField, Select, Link,
  EmptyState, Pagination, Box, Toast, Frame, Spinner, Divider,
  IndexTableSelectionType,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { recalculateInvoice } from "~/lib/order-invoice.server";
import { openUpgradePopup } from "~/components/PlanLimitModal";
import { useEffect, useState, useCallback } from "react";

const PAGE_SIZE = 20;
// Rebuilding an invoice re-fetches the order from Shopify — keep one request reasonably short
const MAX_RECALCULATE = 50;

const INV_TYPE_BADGE: Record<string, { label: string; tone: "info" | "success" | "critical" | "attention" | "warning" }> = {
  TAX_INVOICE:    { label: "Tax Invoice",     tone: "info" },
  BILL_OF_SUPPLY: { label: "Bill of Supply",  tone: "success" },
  CREDIT_NOTE:    { label: "Credit Note",     tone: "critical" },
};

// Date filters are calendar days in India (IST), not UTC
const istStartOfDay = (d: string) => new Date(`${d}T00:00:00+05:30`);
const istEndOfDay = (d: string) => new Date(`${d}T23:59:59.999+05:30`);

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const search   = (url.searchParams.get("search") || "").trim();
  const invType  = url.searchParams.get("invType") || "";
  const taxType  = url.searchParams.get("taxType") || "";
  const page     = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const from     = url.searchParams.get("from") || "";
  const to       = url.searchParams.get("to") || "";

  const createdAt = {
    ...(from && { gte: istStartOfDay(from) }),
    ...(to   && { lte: istEndOfDay(to) }),
  };
  const where = {
    shopId: shop.id,
    ...(search && {
      // Case-insensitive, so "trupti" finds "Trupti"
      OR: [
        { invoiceNumber: { contains: search, mode: "insensitive" as const } },
        { buyerName:     { contains: search, mode: "insensitive" as const } },
        { buyerEmail:    { contains: search, mode: "insensitive" as const } },
        { orderName:     { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(invType && { invoiceType: invType }),
    ...(taxType && { taxType }),
    ...((from || to) && { createdAt }),
  };

  // Totals for everything matching the filters (not just this page) — the numbers a merchant or
  // CA needs for GSTR-1. Credit notes are kept apart: they only carry a (negative) total.
  const invoiceWhere = invType === "CREDIT_NOTE" ? null : invType ? where : { ...where, invoiceType: { not: "CREDIT_NOTE" } };
  const creditWhere = invType && invType !== "CREDIT_NOTE" ? null : { ...where, invoiceType: "CREDIT_NOTE" };

  const [invoices, total, invoiceSums, creditSums] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, invoiceNumber: true, orderName: true, buyerName: true,
        buyerEmail: true, totalAmount: true, taxType: true, supplyType: true,
        invoiceType: true, createdAt: true, emailSentAt: true, pdfUrl: true,
      },
    }),
    prisma.invoice.count({ where }),
    invoiceWhere
      ? prisma.invoice.aggregate({
          where: invoiceWhere,
          _count: true,
          _sum: { taxableAmount: true, shippingAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, shippingTax: true, totalAmount: true },
        })
      : null,
    creditWhere ? prisma.invoice.aggregate({ where: creditWhere, _count: true, _sum: { totalAmount: true } }) : null,
  ]);

  const s = invoiceSums?._sum;
  const totals = {
    invoiceCount: invoiceSums?._count ?? 0,
    taxable: (s?.taxableAmount ?? 0) + (s?.shippingAmount ?? 0),
    cgst: s?.cgstAmount ?? 0,
    sgst: s?.sgstAmount ?? 0,
    igst: s?.igstAmount ?? 0,
    shippingGst: s?.shippingTax ?? 0,
    invoiceTotal: s?.totalAmount ?? 0,
    creditCount: creditSums?._count ?? 0,
    creditTotal: creditSums?._sum.totalAmount ?? 0, // negative
  };

  return json({
    invoices, total, page, totalPages: Math.ceil(total / PAGE_SIZE),
    currentPlan: shop.currentPlan, totals,
  });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // ── Single PDF download (row "Download" button) ────────────────────────────
  if (intent === "download-pdf") {
    const invoiceId = formData.get("invoiceId") as string;
    const inv = await prisma.invoice.findFirst({
      where: { id: invoiceId, shopId: shop.id },
      select: { id: true, invoiceNumber: true },
    });
    if (!inv) return json({ error: "Invoice not found" }, { status: 404 });
    const { generateInvoicePDF } = await import("~/lib/pdf.server");
    const buffer = await generateInvoicePDF(inv.id, "Original");
    const safeName = inv.invoiceNumber.replace(/[/\\:*?"<>|]/g, "-");
    return json({ pdfBase64: buffer.toString("base64"), filename: `${safeName}.pdf` });
  }

  // ── Bulk ZIP download ──────────────────────────────────────────────────────
  if (intent === "bulk-download-zip") {
    if (!canUseFeature(shop.currentPlan, "bulk-download")) {
      return json({ error: "Bulk PDF download requires the Pro plan. Please upgrade." }, { status: 403 });
    }
    const invoiceIds: string[] = JSON.parse(formData.get("invoiceIds") as string || "[]");
    if (!invoiceIds.length) return json({ error: "No invoices selected" }, { status: 400 });

    const { generateInvoicePDF } = await import("~/lib/pdf.server");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const invoiceRecords = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, shopId: shop.id },
      select: { id: true, invoiceNumber: true, invoiceType: true },
    });

    await Promise.all(
      invoiceRecords.map(async (inv) => {
        const buffer = await generateInvoicePDF(inv.id, "Original");
        const safeName = inv.invoiceNumber.replace(/[/\\:*?"<>|]/g, "-");
        zip.file(`${safeName}.pdf`, buffer);
      })
    );

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return json({ zipBase64: zipBuffer.toString("base64"), zipCount: invoiceRecords.length });
  }

  // ── Bulk email send ────────────────────────────────────────────────────────
  if (intent === "bulk-send-email") {
    if (!canUseFeature(shop.currentPlan, "bulk-email")) {
      return json({ error: "Bulk email requires the Pro plan. Please upgrade." }, { status: 403 });
    }
    const invoiceIds: string[] = JSON.parse(formData.get("invoiceIds") as string || "[]");
    if (!invoiceIds.length) return json({ error: "No invoices selected" }, { status: 400 });

    const { generateInvoicePDF } = await import("~/lib/pdf.server");
    const { sendInvoiceEmail } = await import("~/lib/email.server");

    const invoiceRecords = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, shopId: shop.id },
      select: { id: true, invoiceNumber: true, buyerEmail: true, buyerName: true },
    });

    let sent = 0, skipped = 0, failed = 0;
    await Promise.allSettled(
      invoiceRecords.map(async (inv) => {
        if (!inv.buyerEmail) { skipped++; return; }
        try {
          const pdfBuffer = await generateInvoicePDF(inv.id, "Original");
          await sendInvoiceEmail({
            shopId: shop.id,
            invoiceId: inv.id,
            toEmail: inv.buyerEmail,
            toName: inv.buyerName || "",
            invoiceNumber: inv.invoiceNumber,
            pdfBuffer,
          });
          sent++;
        } catch (err) {
          // Count failures so the merchant isn't told "sent" when nothing went out
          failed++;
          console.error(`[invoices bulk email] ${inv.invoiceNumber} failed:`, err);
        }
      })
    );

    return json({ bulkEmailResult: { sent, skipped, failed, total: invoiceRecords.length } });
  }

  // ── Bulk recalculate (rebuild amounts from current Shopify data) ────────────
  if (intent === "bulk-recalculate") {
    const invoiceIds: string[] = JSON.parse(formData.get("invoiceIds") as string || "[]");
    if (!invoiceIds.length) return json({ error: "No invoices selected" }, { status: 400 });
    if (invoiceIds.length > MAX_RECALCULATE) {
      return json({ error: `Please select up to ${MAX_RECALCULATE} invoices at a time to recalculate.` }, { status: 400 });
    }

    // Credit notes aren't built from the order, so only tax invoices are rebuilt
    const targets = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, shopId: shop.id, invoiceType: { not: "CREDIT_NOTE" } },
      select: { orderId: true, invoiceNumber: true },
    });

    let updated = 0, failed = 0;
    for (const t of targets) {
      try {
        const id = await recalculateInvoice(admin, session.shop, shop.id, t.orderId);
        if (id) updated++; else failed++;
      } catch (err) {
        failed++;
        console.error(`[invoices bulk recalculate] ${t.invoiceNumber} failed:`, err);
      }
    }
    return json({ recalcResult: { updated, failed, skipped: invoiceIds.length - targets.length } });
  }

  return json({ success: false });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerDownload(base64: string, filename: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const formatAmount = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// yyyy-mm-dd in the browser's local calendar (merchants are in India)
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Quick ranges for GST filing: returns are filed per month, the year runs April–March
function quickRange(kind: "this-month" | "last-month" | "this-fy"): { from: string; to: string } {
  const now = new Date();
  if (kind === "this-month") return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  if (kind === "last-month") {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: ymd(new Date(fyStartYear, 3, 1)), to: ymd(now) };
}

// Row "Download" button — needs its own fetcher so each row shows its own spinner
function DownloadButton({ invoiceId }: { invoiceId: string }) {
  const fetcher = useFetcher<{ pdfBase64?: string; filename?: string; error?: string }>();
  useEffect(() => {
    if (fetcher.data?.pdfBase64 && fetcher.data.filename) {
      triggerDownload(fetcher.data.pdfBase64, fetcher.data.filename, "application/pdf");
    }
  }, [fetcher.data]);
  return (
    <Button
      size="slim"
      loading={fetcher.state !== "idle"}
      onClick={() => fetcher.submit({ intent: "download-pdf", invoiceId }, { method: "POST" })}
    >
      Download
    </Button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActionData = {
  zipBase64?: string;
  zipCount?: number;
  bulkEmailResult?: { sent: number; skipped: number; failed: number; total: number };
  recalcResult?: { updated: number; failed: number; skipped: number };
  error?: string;
};

export default function InvoicesPage() {
  const outlet = useOutlet();
  const { invoices, total, page, totalPages, currentPlan, totals } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const bulkFetcher = useFetcher<ActionData>();
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);

  const setParams = useCallback((updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(updates)) {
      if (val) p.set(key, val);
      else p.delete(key);
    }
    if (!("page" in updates)) p.set("page", "1");
    setSearchParams(p);
  }, [searchParams, setSearchParams]);
  const setParam = (key: string, val: string) => setParams({ [key]: val });

  // Search: update the URL 400 ms after typing stops, not on every keystroke
  // (trimmed, so a stray space doesn't become "?search=+" and hide the placeholder)
  const urlSearch = (searchParams.get("search") || "").trim();
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => setSearchInput(urlSearch), [urlSearch]);
  useEffect(() => {
    if (searchInput.trim() === urlSearch) return;
    const t = setTimeout(() => setParam("search", searchInput.trim()), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  // Selection that adds up across pages (same behaviour as the Orders list)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = Array.from(selected);
  const handleSelectionChange = useCallback(
    (selectionType: IndexTableSelectionType, isSelecting: boolean, selection?: string | [number, number]) => {
      const pageIds = invoices.map((inv) => inv.id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (selectionType === IndexTableSelectionType.Single && typeof selection === "string") {
          if (isSelecting) next.add(selection);
          else next.delete(selection);
        } else if (selectionType === IndexTableSelectionType.Multi && Array.isArray(selection)) {
          const [start, end] = selection;
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            if (!pageIds[i]) continue;
            if (isSelecting) next.add(pageIds[i]);
            else next.delete(pageIds[i]);
          }
        } else if (selectionType === IndexTableSelectionType.Page || selectionType === IndexTableSelectionType.All) {
          // Header checkbox toggles only this page
          const pageFullySelected = pageIds.length > 0 && pageIds.every((id) => next.has(id));
          pageIds.forEach((id) => (pageFullySelected ? next.delete(id) : next.add(id)));
        }
        return next;
      });
    },
    [invoices]
  );

  const isBulkLoading = bulkFetcher.state !== "idle";
  const bulkIntent = isBulkLoading ? bulkFetcher.formData?.get("intent") : null;

  // Bulk action results
  useEffect(() => {
    const d = bulkFetcher.data;
    if (!d) return;
    if (d.zipBase64) {
      triggerDownload(d.zipBase64, `invoices-${ymd(new Date())}.zip`, "application/zip");
      setToastErr(false);
      setToastMsg(`Downloaded ${d.zipCount ?? 0} invoice PDF(s) as ZIP`);
    } else if (d.bulkEmailResult) {
      const { sent, skipped, failed } = d.bulkEmailResult;
      const parts = [`Sent ${sent} email(s)`];
      if (failed) parts.push(`${failed} failed`);
      if (skipped) parts.push(`${skipped} skipped (no email address)`);
      setToastErr(sent === 0);
      setToastMsg(parts.join(" · "));
      if (sent > 0) setSelected(new Set());
    } else if (d.recalcResult) {
      const { updated, failed, skipped } = d.recalcResult;
      const parts = [`Recalculated ${updated} invoice(s)`];
      if (failed) parts.push(`${failed} failed`);
      if (skipped) parts.push(`${skipped} credit note(s) skipped`);
      setToastErr(updated === 0);
      setToastMsg(parts.join(" · "));
      // Rebuilt invoices get new ids, so the old selection no longer points anywhere
      setSelected(new Set());
    } else if (d.error) {
      setToastErr(true);
      setToastMsg(d.error);
    }
  }, [bulkFetcher.data]);

  const submitBulk = useCallback((intent: string) => {
    if (!selectedIds.length) return;
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("invoiceIds", JSON.stringify(selectedIds));
    bulkFetcher.submit(fd, { method: "POST" });
  }, [selectedIds, bulkFetcher]);

  const canBulkDownload = canUseFeature(currentPlan, "bulk-download");
  const canBulkEmail = canUseFeature(currentPlan, "bulk-email");
  const proPopup = (what: string) => () =>
    openUpgradePopup({
      title: `${what} is a Pro feature`,
      lines: [
        `${what} lets you handle many invoices in one click instead of one by one.`,
        "Upgrade to Pro to use it on all your invoices.",
      ],
    });

  const promotedBulkActions = [
    {
      content: bulkIntent === "bulk-download-zip" ? "Generating…" : "Download PDFs (ZIP)",
      onAction: canBulkDownload ? () => submitBulk("bulk-download-zip") : proPopup("Bulk PDF download"),
      disabled: isBulkLoading,
    },
    {
      content: bulkIntent === "bulk-send-email" ? "Sending…" : "Send Emails",
      onAction: canBulkEmail ? () => submitBulk("bulk-send-email") : proPopup("Bulk email"),
      disabled: isBulkLoading,
    },
    {
      content: bulkIntent === "bulk-recalculate" ? "Recalculating…" : "Recalculate",
      onAction: () => submitBulk("bulk-recalculate"),
      disabled: isBulkLoading,
    },
  ];

  if (outlet) return <>{outlet}</>;

  const hasFilters = !!(urlSearch || searchParams.get("invType") || searchParams.get("taxType") || from || to);
  const activeQuick = (["this-month", "last-month", "this-fy"] as const).find((k) => {
    const r = quickRange(k);
    return r.from === from && r.to === to;
  });

  const rowMarkup = invoices.map((inv, i) => {
    const typeMeta = INV_TYPE_BADGE[inv.invoiceType] ?? { label: inv.invoiceType, tone: "info" as const };

    return (
      <IndexTable.Row id={inv.id} key={inv.id} position={i} selected={selected.has(inv.id)}>
        {/* Compact rows (bodySm) to match Shopify admin's own lists */}
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            {/* dataPrimaryLink: clicking anywhere on the row opens the invoice; only the checkbox selects */}
            <Link url={`/app/invoices/${inv.id}`} dataPrimaryLink monochrome removeUnderline>
              <Text as="span" variant="bodySm" fontWeight="semibold">{inv.invoiceNumber}</Text>
            </Link>
            {/* Tax invoices are the norm — only call out the other document types */}
            {inv.invoiceType !== "TAX_INVOICE" && <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell><Text as="span" variant="bodySm">{inv.orderName || "-"}</Text></IndexTable.Cell>
        <IndexTable.Cell><Text as="span" variant="bodySm">{inv.buyerName || "Guest"}</Text></IndexTable.Cell>
        <IndexTable.Cell><Text as="span" variant="bodySm" tone="subdued">{formatDate(inv.createdAt)}</Text></IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={inv.taxType === "IGST" ? "attention" : "info"}>
            {inv.taxType === "IGST" ? "IGST" : "CGST+SGST"}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={inv.supplyType === "B2B" ? "success" : "info"}>{inv.supplyType}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">{formatAmount(inv.totalAmount)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {inv.emailSentAt ? <Badge tone="success">Sent</Badge> : <Badge>Not sent</Badge>}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <span onClick={(e) => e.stopPropagation()}>
            <InlineStack gap="200" wrap={false}>
              <Button url={`/app/invoices/${inv.id}`} size="slim" variant="primary">View</Button>
              <DownloadButton invoiceId={inv.id} />
            </InlineStack>
          </span>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const gstTotal = totals.cgst + totals.sgst + totals.igst + totals.shippingGst;

  return (
    <Frame>
      {toastMsg && (
        <Toast
          content={toastMsg}
          error={toastErr}
          onDismiss={() => setToastMsg(null)}
        />
      )}
      <Page
        title="Invoices"
        fullWidth
        primaryAction={{ content: "GST Reports", url: "/app/reports" }}
      >
        <TitleBar title="Invoices" />
        <Layout>
          {/* Totals for the current filters — what goes into the GST return */}
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingXs">
                    {hasFilters ? "Totals for current filters" : "All-time totals"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {totals.invoiceCount} invoice(s){totals.creditCount ? ` · ${totals.creditCount} credit note(s)` : ""}
                  </Text>
                </InlineStack>
                <Divider />
                <InlineStack gap="600" wrap>
                  {[
                    { label: "Taxable value", value: totals.taxable },
                    { label: "CGST", value: totals.cgst },
                    { label: "SGST", value: totals.sgst },
                    { label: "IGST", value: totals.igst },
                    ...(totals.shippingGst ? [{ label: "Shipping GST", value: totals.shippingGst }] : []),
                    { label: "Total GST", value: gstTotal },
                    ...(totals.creditCount ? [{ label: "Credit notes", value: totals.creditTotal }] : []),
                    { label: "Net total", value: totals.invoiceTotal + totals.creditTotal, strong: true },
                  ].map((t) => (
                    <BlockStack key={t.label} gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">{t.label}</Text>
                      <Text as="span" variant="bodySm" fontWeight={"strong" in t && t.strong ? "bold" : "medium"}>
                        {formatAmount(t.value)}
                      </Text>
                    </BlockStack>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              {/* Filters */}
              <Box paddingInline="400" paddingBlock="300">
                <BlockStack gap="300">
                  <InlineStack gap="300" wrap>
                    <div style={{ flex: 2, minWidth: 200 }}>
                      <TextField
                        label="" labelHidden
                        placeholder="Search invoice #, buyer, email, order..."
                        value={searchInput}
                        onChange={setSearchInput}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setSearchInput("")}
                      />
                    </div>
                    <Select
                      label="" labelHidden
                      options={[
                        { label: "All Document Types", value: "" },
                        { label: "Tax Invoice",        value: "TAX_INVOICE" },
                        { label: "Bill of Supply",     value: "BILL_OF_SUPPLY" },
                        { label: "Credit Note",        value: "CREDIT_NOTE" },
                      ]}
                      value={searchParams.get("invType") || ""}
                      onChange={(v) => setParam("invType", v)}
                    />
                    <Select
                      label="" labelHidden
                      options={[
                        { label: "All Tax Types",           value: "" },
                        { label: "IGST (Inter-state)",      value: "IGST" },
                        { label: "CGST+SGST (Intra-state)", value: "CGST_SGST" },
                      ]}
                      value={searchParams.get("taxType") || ""}
                      onChange={(v) => setParam("taxType", v)}
                    />
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Button size="slim" pressed={activeQuick === "this-month"} onClick={() => setParams(quickRange("this-month"))}>This month</Button>
                    <Button size="slim" pressed={activeQuick === "last-month"} onClick={() => setParams(quickRange("last-month"))}>Last month</Button>
                    <Button size="slim" pressed={activeQuick === "this-fy"} onClick={() => setParams(quickRange("this-fy"))}>This FY</Button>
                    <div style={{ width: 150 }}>
                      <TextField label="From" labelHidden type="date" value={from} onChange={(v) => setParam("from", v)} autoComplete="off" />
                    </div>
                    <div style={{ width: 150 }}>
                      <TextField label="To" labelHidden type="date" value={to} onChange={(v) => setParam("to", v)} autoComplete="off" />
                    </div>
                    {(from || to) && (
                      <Button size="slim" variant="plain" onClick={() => setParams({ from: "", to: "" })}>Clear dates</Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Box>

              {/* Bulk loading indicator */}
              {isBulkLoading && (
                <Box paddingInline="400" paddingBlock="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      Processing {selectedIds.length} invoice(s)…
                    </Text>
                  </InlineStack>
                </Box>
              )}

              {invoices.length === 0 ? (
                <EmptyState heading="No invoices found" image="">
                  <p>
                    {hasFilters
                      ? "No invoices match the current filters."
                      : "Invoices are created automatically when an order is paid. Credit notes appear when refunds are processed."}
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "invoice", plural: "invoices" }}
                  itemCount={invoices.length}
                  selectedItemsCount={selected.size}
                  onSelectionChange={handleSelectionChange}
                  promotedBulkActions={promotedBulkActions}
                  headings={[
                    { title: "Invoice #" },
                    { title: "Order" },
                    { title: "Buyer" },
                    { title: "Date" },
                    { title: "Tax Type" },
                    { title: "B2B/B2C" },
                    { title: "Amount" },
                    { title: "Email" },
                    { title: "Actions" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}

            </Card>

            <div style={{
              position: "sticky",
              bottom: 0,
              background: "var(--p-color-bg-surface)",
              borderTop: "1px solid var(--p-color-border)",
              zIndex: 2,
            }}>
              <Box paddingBlock="300" paddingInline="400">
                <InlineStack align="center" gap="200" blockAlign="center">
                  <Pagination
                    hasPrevious={page > 1}
                    onPrevious={() => setParam("page", String(page - 1))}
                    hasNext={page < totalPages}
                    onNext={() => setParam("page", String(page + 1))}
                  />
                  <Text as="span" variant="bodySm" tone="subdued">
                    {total === 0 ? "0" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`} of {total}
                  </Text>
                </InlineStack>
              </Box>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
