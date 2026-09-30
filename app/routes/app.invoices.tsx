import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useOutlet, useNavigate, Link } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, IndexTable, TextField, Select,
  EmptyState, Pagination, Box, Toast, Frame, Spinner,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { useEffect, useState, useCallback } from "react";

const PAGE_SIZE = 20;

const INV_TYPE_BADGE: Record<string, { label: string; tone: "info" | "success" | "critical" | "attention" | "warning" }> = {
  TAX_INVOICE:    { label: "Tax Invoice",     tone: "info" },
  BILL_OF_SUPPLY: { label: "Bill of Supply",  tone: "success" },
  CREDIT_NOTE:    { label: "Credit Note",     tone: "critical" },
};

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const search   = url.searchParams.get("search") || "";
  const invType  = url.searchParams.get("invType") || "";
  const taxType  = url.searchParams.get("taxType") || "";
  const page     = parseInt(url.searchParams.get("page") || "1", 10);
  const from     = url.searchParams.get("from") || "";
  const to       = url.searchParams.get("to") || "";

  const where = {
    shopId: shop.id,
    ...(search && {
      OR: [
        { invoiceNumber: { contains: search } },
        { buyerName:     { contains: search } },
        { buyerEmail:    { contains: search } },
        { orderName:     { contains: search } },
      ],
    }),
    ...(invType && { invoiceType: invType }),
    ...(taxType && { taxType }),
    ...(from    && { createdAt: { gte: new Date(from) } }),
    ...(to      && { createdAt: { lte: new Date(to + "T23:59:59Z") } }),
  };

  const [invoices, total] = await Promise.all([
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
  ]);

  return json({ invoices, total, page, totalPages: Math.ceil(total / PAGE_SIZE), currentPlan: shop.currentPlan });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

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
    return json({ zipBase64: zipBuffer.toString("base64") });
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

    let sent = 0, skipped = 0;
    await Promise.allSettled(
      invoiceRecords.map(async (inv) => {
        if (!inv.buyerEmail) { skipped++; return; }
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
      })
    );

    return json({ bulkEmailResult: { sent, skipped, total: invoiceRecords.length } });
  }

  return json({ success: false });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerZipDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActionData = {
  zipBase64?: string;
  bulkEmailResult?: { sent: number; skipped: number; total: number };
  error?: string;
};

export default function InvoicesPage() {
  const outlet = useOutlet();
  const navigate = useNavigate();
  const { invoices, total, page, totalPages, currentPlan } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const bulkFetcher = useFetcher<ActionData>();

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const formatAmount = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

  const setParam = (key: string, val: string) => {
    const p = new URLSearchParams(searchParams);
    val ? p.set(key, val) : p.delete(key);
    if (key !== "page") p.set("page", "1");
    setSearchParams(p);
  };

  // IndexTable selection
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(invoices.map((inv) => ({ id: inv.id })));

  const isBulkLoading = bulkFetcher.state !== "idle";

  // Handle ZIP download response
  useEffect(() => {
    if (bulkFetcher.data?.zipBase64) {
      const today = new Date().toISOString().split("T")[0];
      triggerZipDownload(bulkFetcher.data.zipBase64, `invoices-${today}.zip`);
      setToastErr(false);
      setToastMsg(`Downloaded ${selectedResources.length} invoice PDF(s) as ZIP`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkFetcher.data]);

  // Handle bulk email response
  useEffect(() => {
    if (bulkFetcher.data?.bulkEmailResult) {
      const { sent, skipped } = bulkFetcher.data.bulkEmailResult;
      setToastErr(skipped > 0 && sent === 0);
      setToastMsg(
        skipped > 0
          ? `Sent ${sent} email(s). ${skipped} skipped (no email address).`
          : `Successfully sent ${sent} invoice email(s).`
      );
    }
  }, [bulkFetcher.data]);

  // Handle error response
  useEffect(() => {
    if (bulkFetcher.data?.error) {
      setToastErr(true);
      setToastMsg(bulkFetcher.data.error);
    }
  }, [bulkFetcher.data]);

  const handleBulkDownload = useCallback(() => {
    if (!selectedResources.length) return;
    const fd = new FormData();
    fd.append("intent", "bulk-download-zip");
    fd.append("invoiceIds", JSON.stringify(selectedResources));
    bulkFetcher.submit(fd, { method: "POST" });
  }, [selectedResources, bulkFetcher]);

  const handleBulkEmail = useCallback(() => {
    if (!selectedResources.length) return;
    const fd = new FormData();
    fd.append("intent", "bulk-send-email");
    fd.append("invoiceIds", JSON.stringify(selectedResources));
    bulkFetcher.submit(fd, { method: "POST" });
  }, [selectedResources, bulkFetcher]);

  const canBulkDownload = canUseFeature(currentPlan, "bulk-download");
  const canBulkEmail = canUseFeature(currentPlan, "bulk-email");

  const promotedBulkActions = [
    {
      content: canBulkDownload
        ? (isBulkLoading ? "Generating…" : `Download PDFs (${selectedResources.length})`)
        : "Download PDFs [Pro]",
      onAction: canBulkDownload ? handleBulkDownload : () => navigate("/app/billing"),
      disabled: isBulkLoading,
    },
    {
      content: canBulkEmail
        ? (isBulkLoading ? "Sending…" : `Send Emails (${selectedResources.length})`)
        : "Send Emails [Pro]",
      onAction: canBulkEmail ? handleBulkEmail : () => navigate("/app/billing"),
      disabled: isBulkLoading,
    },
  ];

  if (outlet) return <>{outlet}</>;

  const rowMarkup = invoices.map((inv, i) => {
    const typeMeta = INV_TYPE_BADGE[inv.invoiceType] ?? { label: inv.invoiceType, tone: "info" as const };

    return (
      <IndexTable.Row
        id={inv.id}
        key={inv.id}
        position={i}
        selected={selectedResources.includes(inv.id)}
      >
        <IndexTable.Cell>
          {/* stopPropagation: prevents link click from also checking the row checkbox */}
          <span onClick={(e) => e.stopPropagation()}>
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {/* Remix Link (client-side navigation) — a plain <a href> reloads the iframe without
                    the embedded params and lands on the login page */}
                <Link to={`/app/invoices/${inv.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  {inv.invoiceNumber}
                </Link>
              </Text>
              <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>
            </BlockStack>
          </span>
        </IndexTable.Cell>
        <IndexTable.Cell>{inv.orderName || "-"}</IndexTable.Cell>
        <IndexTable.Cell>{inv.buyerName || "Guest"}</IndexTable.Cell>
        <IndexTable.Cell>{formatDate(inv.createdAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={inv.taxType === "IGST" ? "attention" : "info"}>
            {inv.taxType === "IGST" ? "IGST" : "CGST+SGST"}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={inv.supplyType === "B2B" ? "success" : "info"}>{inv.supplyType}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {formatAmount(inv.totalAmount)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {inv.emailSentAt ? (
            <Badge tone="success">Sent</Badge>
          ) : (
            <Badge>Pending</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <span onClick={(e) => e.stopPropagation()}>
            <InlineStack gap="200">
              <Button url={`/app/invoices/${inv.id}`} size="slim" variant="primary">View</Button>
              <Button url={`/app/invoices/${inv.id}`} size="slim" variant="plain">Download</Button>
            </InlineStack>
          </span>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

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
        primaryAction={{ content: "GST Reports", url: "/app/reports" }}
      >
        <TitleBar title="Invoices" />
        <Layout>
          <Layout.Section>
            <Card padding="0">
              {/* Filters */}
              <Box paddingInline="400" paddingBlock="300">
                <InlineStack gap="300" wrap>
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <TextField
                      label="" labelHidden
                      placeholder="Search invoice #, buyer, order..."
                      value={searchParams.get("search") || ""}
                      onChange={(v) => setParam("search", v)}
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={() => setParam("search", "")}
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
              </Box>

              {/* Bulk loading indicator */}
              {isBulkLoading && (
                <Box paddingInline="400" paddingBlock="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      Processing {selectedResources.length} invoice(s)…
                    </Text>
                  </InlineStack>
                </Box>
              )}

              {invoices.length === 0 ? (
                <EmptyState heading="No invoices found" image="">
                  <p>Invoices are auto-generated when orders are placed. Credit notes appear when refunds are processed.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "invoice", plural: "invoices" }}
                  itemCount={invoices.length}
                  selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
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
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}
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
