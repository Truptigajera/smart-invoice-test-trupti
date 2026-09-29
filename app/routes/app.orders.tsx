import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  IndexTable,
  TextField,
  Select,
  EmptyState,
  Pagination,
  Box,
  Tabs,
  Spinner,
  Banner,
  Toast,
  Frame,
  ActionList,
  Popover,
  Modal,
  ChoiceList,
} from "@shopify/polaris";
import type { IndexTableSelectionType } from "@shopify/polaris";
import { ArrowDownIcon, PrintIcon, MenuVerticalIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { generateInvoicePDF, generatePackingSlipBuffer } from "~/lib/pdf.server";
import { sendInvoiceEmail } from "~/lib/email.server";
import { ensureInvoiceExists } from "~/lib/order-invoice.server";

const PAGE_SIZE = 25;

// ─── GraphQL Query ────────────────────────────────────────────────────────────

const ORDERS_QUERY = `
  query getOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
        hasPreviousPage
        startCursor
      }
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          displayFinancialStatus
          displayFulfillmentStatus
        }
      }
    }
  }
`;

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || null;
  const direction = url.searchParams.get("dir") || "next"; // "next" | "prev"
  const tab = url.searchParams.get("tab") || "0"; // "0" = orders, "1" = credit notes
  const fulfillmentFilter = url.searchParams.get("fulfillment") || "";
  const paymentFilter = url.searchParams.get("payment") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";

  // Build Shopify search query string
  const queryParts: string[] = [];
  if (searchQuery) queryParts.push(`name:*${searchQuery}* OR email:*${searchQuery}*`);
  if (fulfillmentFilter) queryParts.push(`fulfillment_status:${fulfillmentFilter}`);
  if (paymentFilter) queryParts.push(`financial_status:${paymentFilter}`);
  if (dateFrom) queryParts.push(`created_at:>=${dateFrom}`);
  if (dateTo) queryParts.push(`created_at:<=${dateTo}`);
  const gqlQuery = queryParts.join(" AND ");

  // Fetch orders from Shopify Admin GraphQL
  let ordersData: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        customer: { displayName: string; email: string } | null;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        displayFinancialStatus: string;
        displayFulfillmentStatus: string;
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
      hasPreviousPage: boolean;
      startCursor: string | null;
    };
  } = { edges: [], pageInfo: { hasNextPage: false, endCursor: null, hasPreviousPage: false, startCursor: null } };
  // Shown instead of "No orders in your store yet" when Shopify couldn't be reached
  let loadError = false;

  try {
    const variables: Record<string, unknown> = {
      first: PAGE_SIZE,
      query: gqlQuery || null,
    };
    if (cursor && direction === "next") variables.after = cursor;

    const response = await admin.graphql(ORDERS_QUERY, { variables });
    const data = await response.json();
    ordersData = data.data?.orders ?? ordersData;
  } catch (err) {
    // admin.graphql throws on GraphQL/auth errors (e.g. a rejected access token)
    console.error("[orders loader] GraphQL error:", err);
    loadError = true;
  }

  // Extract numeric IDs to look up in our DB
  const shopifyIds = ordersData.edges.map((e) => e.node.id.split("/").pop()!);

  // Fetch matching invoices from our DB
  const existingInvoices = await prisma.invoice.findMany({
    where: {
      shopId: shop.id,
      orderId: { in: shopifyIds },
    },
    select: {
      id: true,
      orderId: true,
      pdfUrl: true,
      emailSentAt: true,
      invoiceNumber: true,
      invoiceType: true,
      buyerEmail: true,
      buyerName: true,
    },
  });

  const invoiceMap = new Map(existingInvoices.map((inv) => [inv.orderId, inv]));

  // For Credit Notes tab — fetch from DB directly
  const creditNotes = await prisma.invoice.findMany({
    where: { shopId: shop.id, invoiceType: "CREDIT_NOTE" },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      invoiceNumber: true,
      orderName: true,
      buyerName: true,
      buyerEmail: true,
      totalAmount: true,
      createdAt: true,
      emailSentAt: true,
      pdfUrl: true,
      invoiceType: true,
      orderId: true,
    },
  });

  return json({
    shopId: shop.id,
    orders: ordersData.edges,
    pageInfo: ordersData.pageInfo,
    invoiceMap: Object.fromEntries(invoiceMap),
    creditNotes,
    searchQuery,
    tab,
    fulfillmentFilter,
    paymentFilter,
    dateFrom,
    dateTo,
    loadError,
  });
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // helper — generate PDF buffer and return as base64 JSON
  async function pdfResponse(invoiceId: string, copyType: "Original" | "Duplicate" | "Triplicate" = "Original") {
    const buffer = await generateInvoicePDF(invoiceId, copyType);
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } });
    const filename = `Invoice-${inv?.invoiceNumber || invoiceId}${copyType !== "Original" ? `-${copyType}` : ""}.pdf`;
    return json({ success: true, pdfBase64: buffer.toString("base64"), filename, invoiceId });
  }

  // ── Generate / Download Invoice PDF (any copy type) ───────────────────────
  if (intent === "generate-pdf") {
    const shopifyOrderGid = formData.get("shopifyOrderGid") as string;
    const copyType = (formData.get("copyType") as string || "Original") as "Original" | "Duplicate" | "Triplicate";
    const numericOrderId = shopifyOrderGid.split("/").pop()!;
    try {
      const invoiceId = await ensureInvoiceExists(admin, shopDomain, shop.id, numericOrderId);
      if (!invoiceId) return json({ error: "Order not found in Shopify" }, { status: 404 });
      return pdfResponse(invoiceId, copyType);
    } catch (err) {
      console.error("[orders action] generate-pdf error:", err);
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Download existing invoice (already has invoiceId) ────────────────────
  if (intent === "download-pdf") {
    const invoiceId = formData.get("invoiceId") as string;
    const copyType = (formData.get("copyType") as string || "Original") as "Original" | "Duplicate" | "Triplicate";
    try {
      return pdfResponse(invoiceId, copyType);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Packing Slip ─────────────────────────────────────────────────────────
  if (intent === "generate-packing-slip") {
    const invoiceId = formData.get("invoiceId") as string;
    if (!invoiceId) return json({ error: "Invoice ID missing" }, { status: 400 });
    try {
      const buffer = await generatePackingSlipBuffer(invoiceId);
      const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } });
      return json({ success: true, pdfBase64: buffer.toString("base64"), filename: `PackingSlip-${inv?.invoiceNumber || invoiceId}.pdf` });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Send Email (generate PDF on-the-fly for attachment) ──────────────────
  if (intent === "send-email") {
    const invoiceId = formData.get("invoiceId") as string;
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, invoiceNumber: true, buyerEmail: true, buyerName: true },
      });
      if (!invoice?.buyerEmail) return json({ error: "Invoice missing email address" }, { status: 400 });

      const pdfBuffer = await generateInvoicePDF(invoiceId, "Original");
      await sendInvoiceEmail({
        shopId: shop.id,
        invoiceId: invoice.id,
        toEmail: invoice.buyerEmail,
        toName: invoice.buyerName || "Customer",
        invoiceNumber: invoice.invoiceNumber,
        pdfBuffer,
      });
      return json({ success: true, message: "Invoice emailed successfully" });
    } catch (err) {
      console.error("[orders action] send-email error:", err);
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Bulk Generate & Download ──────────────────────────────────────────────
  if (intent === "bulk-generate-pdf") {
    const orderIdsStr = formData.get("orderIds") as string;
    const orderIds = orderIdsStr?.split(",").filter(Boolean) ?? [];
    const results: Array<{ pdfBase64: string; filename: string }> = [];
    for (const numericOrderId of orderIds) {
      try {
        const invoiceId = await ensureInvoiceExists(admin, shopDomain, shop.id, numericOrderId);
        if (!invoiceId) continue;
        const buffer = await generateInvoicePDF(invoiceId, "Original");
        const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } });
        results.push({ pdfBase64: buffer.toString("base64"), filename: `Invoice-${inv?.invoiceNumber || invoiceId}.pdf` });
      } catch { /* skip individual failures */ }
    }
    return json({ success: true, bulkPdfs: results });
  }

  // ── Bulk Send Emails ─────────────────────────────────────────────────────
  if (intent === "bulk-send-email") {
    const orderIdsStr = formData.get("orderIds") as string;
    const orderIds = orderIdsStr?.split(",").filter(Boolean) ?? [];
    const invoices = await prisma.invoice.findMany({
      where: { shopId: shop.id, orderId: { in: orderIds } },
      select: { id: true, buyerEmail: true, buyerName: true, invoiceNumber: true },
    });
    let sent = 0;
    let failed = 0;
    for (const inv of invoices) {
      if (!inv.buyerEmail) { failed++; continue; }
      try {
        const buffer = await generateInvoicePDF(inv.id, "Original");
        await sendInvoiceEmail({
          shopId: shop.id,
          invoiceId: inv.id,
          toEmail: inv.buyerEmail,
          toName: inv.buyerName || "Customer",
          invoiceNumber: inv.invoiceNumber,
          pdfBuffer: buffer,
        });
        sent++;
      } catch { failed++; }
    }
    return json({ success: true, sent, failed });
  }

  // ── Recalculate Invoice ──────────────────────────────────────────────────
  if (intent === "recalculate-invoice") {
    const shopifyOrderGid = formData.get("shopifyOrderGid") as string;
    const numericOrderId = shopifyOrderGid.split("/").pop()!;
    try {
      // Delete existing invoice (and its line items via cascade)
      await prisma.invoice.deleteMany({ where: { shopId: shop.id, orderId: numericOrderId } });
      // Re-create fresh from Shopify
      const invoiceId = await ensureInvoiceExists(admin, shopDomain, shop.id, numericOrderId);
      if (!invoiceId) return json({ error: "Order not found in Shopify" }, { status: 404 });
      return json({ success: true, message: "Invoice recalculated successfully", invoiceId });
    } catch (err) {
      console.error("[orders action] recalculate-invoice error:", err);
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(amount: string, currency: string) {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
  }).format(num);
}

function paymentStatusTone(
  status: string
): "success" | "warning" | "critical" | "info" | undefined {
  switch (status?.toUpperCase()) {
    case "PAID":
      return "success";
    case "PENDING":
    case "PARTIALLY_PAID":
      return "warning";
    case "REFUNDED":
    case "VOIDED":
      return "critical";
    default:
      return "info";
  }
}

function fulfillmentStatusTone(
  status: string
): "success" | "attention" | "warning" | undefined {
  switch (status?.toUpperCase()) {
    case "FULFILLED":
      return "success";
    case "UNFULFILLED":
      return "attention";
    case "PARTIAL":
      return "warning";
    default:
      return undefined;
  }
}

// ─── Order Row Component ──────────────────────────────────────────────────────

interface OrderRowProps {
  order: {
    id: string;
    name: string;
    createdAt: string;
    customer: { displayName: string; email: string } | null;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    displayFinancialStatus: string;
    displayFulfillmentStatus: string;
  };
  invoice: {
    id: string;
    orderId: string;
    pdfUrl: string | null;
    emailSentAt: string | null;
    invoiceNumber: string;
    buyerEmail: string | null;
  } | null;
  position: number;
  selected?: boolean;
}

// ─── Helper: trigger browser download from base64 PDF ────────────────────────

function triggerPdfDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Download Modal ───────────────────────────────────────────────────────────
// Mounted only when open — unmounts on close so fetcher resets, preventing
// stale-data auto-downloads on subsequent opens.

function DownloadModal({
  orderName,
  shopifyOrderGid,
  invoiceId,
  onClose,
}: {
  orderName: string;
  shopifyOrderGid: string;
  invoiceId: string | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ pdfBase64?: string; filename?: string; error?: string }>();
  const [docType, setDocType] = useState(["invoice"]);
  const [copyType, setCopyType] = useState(["Original"]);

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.pdfBase64 && fetcher.data?.filename) {
      triggerPdfDownload(fetcher.data.pdfBase64, fetcher.data.filename);
      onClose();
    }
  }, [fetcher.data, onClose]);

  const handleDownload = useCallback(() => {
    if (docType[0] === "credit") { onClose(); return; }

    if (docType[0] === "packaging") {
      if (!invoiceId) return;
      fetcher.submit({ intent: "generate-packing-slip", invoiceId }, { method: "POST" });
      return;
    }

    const selected = copyType[0] as "Original" | "Duplicate" | "Triplicate";
    if (invoiceId) {
      fetcher.submit({ intent: "download-pdf", invoiceId, copyType: selected }, { method: "POST" });
    } else {
      fetcher.submit({ intent: "generate-pdf", shopifyOrderGid, copyType: selected }, { method: "POST" });
    }
  }, [docType, copyType, invoiceId, shopifyOrderGid, fetcher, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Download Order ${orderName}`}
      primaryAction={{
        content: isLoading ? "Preparing…" : "Download Order",
        onAction: handleDownload,
        loading: isLoading,
        disabled: isLoading || docType[0] === "credit",
      }}
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section>
        {docType[0] === "credit" && (
          <div style={{ marginBottom: 12 }}>
            <Banner tone="info">Credit Notes are generated automatically when a refund is issued.</Banner>
          </div>
        )}
        {fetcher.data?.error && (
          <div style={{ marginBottom: 12 }}>
            <Banner tone="critical">{fetcher.data.error}</Banner>
          </div>
        )}
        <BlockStack gap="400">
          <ChoiceList
            title="Select download type"
            choices={[
              { label: "Invoice", value: "invoice" },
              { label: "Packaging slips", value: "packaging" },
              { label: "Credit Notes", value: "credit" },
            ]}
            selected={docType}
            onChange={setDocType}
          />
          {docType[0] === "invoice" && (
            <ChoiceList
              title="Select invoice types"
              choices={[
                { label: "Original", value: "Original" },
                { label: "Duplicate", value: "Duplicate" },
                { label: "Triplicate", value: "Triplicate" },
              ]}
              selected={copyType}
              onChange={setCopyType}
            />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ─── Order Row ────────────────────────────────────────────────────────────────

function OrderRow({ order, invoice, position, selected }: OrderRowProps) {
  const sendFetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const recalcFetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const [sendPopoverActive, setSendPopoverActive] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [recalcToast, setRecalcToast] = useState<{ message: string; error?: boolean } | null>(null);

  const numericId = order.id.split("/").pop()!;
  const currentInvoiceId = invoice?.id || null;
  const isSending = sendFetcher.state !== "idle";
  const isRecalculating = recalcFetcher.state !== "idle";

  useEffect(() => {
    const d = recalcFetcher.data;
    if (!d) return;
    if (d.success) setRecalcToast({ message: "Invoice recalculated successfully" });
    else if (d.error) setRecalcToast({ message: d.error, error: true });
  }, [recalcFetcher.data]);

  const handleRecalculate = useCallback(() => {
    setSendPopoverActive(false);
    recalcFetcher.submit(
      { intent: "recalculate-invoice", shopifyOrderGid: order.id },
      { method: "POST" }
    );
  }, [recalcFetcher, order.id]);

  const handleQuickSend = useCallback(() => {
    if (!currentInvoiceId) return;
    setSendPopoverActive(false);
    sendFetcher.submit(
      { intent: "send-email", invoiceId: currentInvoiceId },
      { method: "POST" }
    );
  }, [sendFetcher, currentInvoiceId]);

  return (
    <IndexTable.Row id={order.id} key={order.id} position={position} selected={selected}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{order.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">{formatDate(order.createdAt)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="0">
          <Text as="span" variant="bodyMd">{order.customer?.displayName || "Guest"}</Text>
          {order.customer?.email && (
            <Text as="span" variant="bodySm" tone="subdued">{order.customer.email}</Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {formatAmount(order.totalPriceSet.shopMoney.amount, order.totalPriceSet.shopMoney.currencyCode)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={paymentStatusTone(order.displayFinancialStatus)}>
          {order.displayFinancialStatus?.replace(/_/g, " ") || "—"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={fulfillmentStatusTone(order.displayFulfillmentStatus)}>
          {order.displayFulfillmentStatus?.replace(/_/g, " ") || "—"}
        </Badge>
      </IndexTable.Cell>

      {/* Actions */}
      <IndexTable.Cell>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div onClick={(e) => e.stopPropagation()}>
          <InlineStack gap="150" blockAlign="center" wrap={false}>

            {/* PDF → opens download modal */}
            <Button size="slim" icon={ArrowDownIcon} onClick={() => setDownloadModalOpen(true)}>
              PDF
            </Button>

            {/* Conditionally mount modal — unmounts on close, resetting fetcher */}
            {downloadModalOpen && (
              <DownloadModal
                orderName={order.name}
                shopifyOrderGid={order.id}
                invoiceId={currentInvoiceId}
                onClose={() => setDownloadModalOpen(false)}
              />
            )}

            {/* Print page */}
            <Button url={`/app/print/${numericId}`} size="slim" icon={PrintIcon}>
              Print
            </Button>

            {/* ⋮ send actions */}
            <Popover
              active={sendPopoverActive}
              activator={
                <Button
                  size="slim"
                  variant="plain"
                  icon={MenuVerticalIcon}
                  onClick={() => setSendPopoverActive((v) => !v)}
                  loading={isSending || isRecalculating}
                />
              }
              onClose={() => setSendPopoverActive(false)}
            >
              <ActionList
                sections={[
                  {
                    title: "Send Invoice",
                    items: [
                      {
                        content: "Quick send",
                        helpText: "Send to customer email on file",
                        onAction: handleQuickSend,
                        disabled: !currentInvoiceId,
                      },
                      {
                        content: "Preview and send",
                        helpText: "View invoice before sending",
                        url: currentInvoiceId ? `/app/invoices/${currentInvoiceId}` : undefined,
                        disabled: !currentInvoiceId,
                      },
                    ],
                  },
                  {
                    title: "Invoice",
                    items: [
                      {
                        content: "Recalculate Invoice",
                        helpText: "Re-fetch from Shopify and recalculate taxes/discounts",
                        onAction: handleRecalculate,
                      },
                    ],
                  },
                ]}
              />
            </Popover>

            {recalcToast && (
              <Toast
                content={recalcToast.message}
                error={recalcToast.error}
                onDismiss={() => setRecalcToast(null)}
              />
            )}

            {sendFetcher.data?.success && (
              <Text as="span" variant="bodySm" tone="success">Sent!</Text>
            )}
            {sendFetcher.data?.error && (
              <Text as="span" variant="bodySm" tone="critical">{sendFetcher.data.error}</Text>
            )}
          </InlineStack>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

// ─── Credit Notes Tab ─────────────────────────────────────────────────────────

interface CreditNoteRowProps {
  note: {
    id: string;
    invoiceNumber: string;
    orderName: string | null;
    buyerName: string | null;
    buyerEmail: string | null;
    totalAmount: number;
    createdAt: string;
    emailSentAt: string | null;
    pdfUrl: string | null;
    orderId: string;
  };
  position: number;
}

function CreditNoteRow({ note, position }: CreditNoteRowProps) {
  const fetcher = useFetcher<{ success?: boolean; pdfBase64?: string; filename?: string; error?: string }>();
  const isGenerating = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.pdfBase64 && fetcher.data?.filename) {
      triggerPdfDownload(fetcher.data.pdfBase64, fetcher.data.filename);
    }
  }, [fetcher.data]);

  return (
    <IndexTable.Row id={note.id} key={note.id} position={position}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {note.invoiceNumber}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(note.createdAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{note.orderName || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{note.buyerName || "Guest"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
          }).format(note.totalAmount)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {note.emailSentAt ? (
          <Badge tone="success">Sent</Badge>
        ) : (
          <Badge tone="attention">Pending</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div onClick={(e) => e.stopPropagation()}>
          <InlineStack gap="200">
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="download-pdf" />
              <input type="hidden" name="invoiceId" value={note.id} />
              <input type="hidden" name="copyType" value="Original" />
              <Button submit size="slim" variant="secondary" loading={isGenerating}>
                {isGenerating ? "Preparing…" : "Download"}
              </Button>
            </fetcher.Form>
            <Button url={`/app/invoices/${note.id}`} size="slim" variant="plain">
              View
            </Button>
          </InlineStack>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function OrdersPage() {
  const { orders, pageInfo, invoiceMap, creditNotes, searchQuery, tab,
    fulfillmentFilter, paymentFilter, dateFrom, dateTo, loadError } =
    useLoaderData<typeof loader>();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [searchValue, setSearchValue] = useState(searchQuery);
  const [fulfillmentValue, setFulfillmentValue] = useState(fulfillmentFilter);
  const [paymentValue, setPaymentValue] = useState(paymentFilter);
  const [dateFromValue, setDateFromValue] = useState(dateFrom);
  const [dateToValue, setDateToValue] = useState(dateTo);

  // Bulk selection state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const bulkFetcher = useFetcher<{ success?: boolean; bulkPdfs?: Array<{ pdfBase64: string; filename: string }>; sent?: number; failed?: number; error?: string }>();
  const [bulkToast, setBulkToast] = useState<{ message: string; error?: boolean } | null>(null);

  const selectedTab = parseInt(tab, 10);

  const handleTabChange = useCallback(
    (index: number) => {
      const p = new URLSearchParams(searchParams);
      p.set("tab", String(index));
      p.delete("cursor");
      p.delete("dir");
      setSearchParams(p);
    },
    [searchParams, setSearchParams]
  );

  const applyFilters = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    if (searchValue) p.set("q", searchValue); else p.delete("q");
    if (fulfillmentValue) p.set("fulfillment", fulfillmentValue); else p.delete("fulfillment");
    if (paymentValue) p.set("payment", paymentValue); else p.delete("payment");
    if (dateFromValue) p.set("dateFrom", dateFromValue); else p.delete("dateFrom");
    if (dateToValue) p.set("dateTo", dateToValue); else p.delete("dateTo");
    p.delete("cursor");
    p.delete("dir");
    setSearchParams(p);
  }, [searchValue, fulfillmentValue, paymentValue, dateFromValue, dateToValue, searchParams, setSearchParams]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    setFulfillmentValue("");
    setPaymentValue("");
    setDateFromValue("");
    setDateToValue("");
    const p = new URLSearchParams(searchParams);
    p.delete("q");
    p.delete("fulfillment");
    p.delete("payment");
    p.delete("dateFrom");
    p.delete("dateTo");
    p.delete("cursor");
    p.delete("dir");
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  const handleNextPage = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set("cursor", pageInfo.endCursor || "");
    p.set("dir", "next");
    setSearchParams(p);
  }, [pageInfo.endCursor, searchParams, setSearchParams]);

  const handlePrevPage = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set("cursor", pageInfo.startCursor || "");
    p.set("dir", "prev");
    setSearchParams(p);
  }, [pageInfo.startCursor, searchParams, setSearchParams]);

  // Bulk selection handlers
  const handleSelectionChange = useCallback(
    (selectionType: IndexTableSelectionType, isSelecting: boolean, selection?: string) => {
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (selectionType === "single" && selection) {
          // selection is the Shopify GID; use numeric id as key
          const numId = selection.split("/").pop()!;
          if (isSelecting) next.add(numId);
          else next.delete(numId);
        } else if (selectionType === "page" || selectionType === "all") {
          if (isSelecting) {
            orders.forEach((e) => next.add(e.node.id.split("/").pop()!));
          } else {
            orders.forEach((e) => next.delete(e.node.id.split("/").pop()!));
          }
        }
        return next;
      });
    },
    [orders]
  );

  // Bulk PDF download: trigger browser download for each base64 PDF
  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data) return;
    if (data.bulkPdfs && data.bulkPdfs.length > 0) {
      data.bulkPdfs.forEach(({ pdfBase64, filename }) => {
        triggerPdfDownload(pdfBase64, filename);
      });
      setBulkToast({ message: `${data.bulkPdfs.length} PDF(s) downloaded` });
      setSelectedItems(new Set());
    } else if (data.sent !== undefined) {
      setBulkToast({ message: `Emails sent: ${data.sent}${data.failed ? `, failed: ${data.failed}` : ""}`, error: (data.failed ?? 0) > 0 });
      setSelectedItems(new Set());
    } else if (data.error) {
      setBulkToast({ message: data.error, error: true });
    }
  }, [bulkFetcher.data]);

  const handleBulkGeneratePDF = useCallback(() => {
    if (selectedItems.size === 0) return;
    bulkFetcher.submit(
      { intent: "bulk-generate-pdf", orderIds: Array.from(selectedItems).join(",") },
      { method: "POST" }
    );
  }, [bulkFetcher, selectedItems]);

  const handleBulkSendEmail = useCallback(() => {
    if (selectedItems.size === 0) return;
    bulkFetcher.submit(
      { intent: "bulk-send-email", orderIds: Array.from(selectedItems).join(",") },
      { method: "POST" }
    );
  }, [bulkFetcher, selectedItems]);

  const tabs = [
    { id: "orders", content: "Orders", panelID: "orders-panel" },
    { id: "credit-notes", content: `Credit Notes (${creditNotes.length})`, panelID: "credit-notes-panel" },
  ];

  // Build the Orders index table rows
  const orderRowMarkup = orders.map((edge, i) => {
    const numericId = edge.node.id.split("/").pop()!;
    const inv = invoiceMap[numericId] ?? null;
    return (
      <OrderRow
        key={edge.node.id}
        order={edge.node}
        invoice={inv}
        position={i}
        selected={selectedItems.has(numericId)}
      />
    );
  });

  // Build the Credit Notes index table rows
  const creditNoteRowMarkup = creditNotes.map((note, i) => (
    <CreditNoteRow key={note.id} note={note} position={i} />
  ));

  const hasActiveFilters = !!(fulfillmentFilter || paymentFilter || dateFrom || dateTo);

  return (
    <Frame>
      {bulkToast && (
        <Toast
          content={bulkToast.message}
          error={bulkToast.error}
          onDismiss={() => setBulkToast(null)}
        />
      )}
      <Page title="Orders">
        <TitleBar title="Orders" />
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                {/* ── Orders Tab ── */}
                {selectedTab === 0 && (
                  <Box>
                    {/* Search + Filters */}
                    <Box paddingInline="400" paddingBlockStart="300" paddingBlockEnd="200">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="end">
                          <div style={{ flex: 1 }}>
                            <TextField
                              label=""
                              labelHidden
                              placeholder="Search by order # or customer name/email…"
                              value={searchValue}
                              onChange={setSearchValue}
                              autoComplete="off"
                              clearButton
                              onClearButtonClick={handleSearchClear}
                            />
                          </div>
                          <Button onClick={applyFilters} variant="primary">
                            Search
                          </Button>
                          {hasActiveFilters && (
                            <Button onClick={handleSearchClear} variant="plain" tone="critical">
                              Clear filters
                            </Button>
                          )}
                        </InlineStack>
                        <InlineStack gap="200" wrap>
                          <div style={{ minWidth: 160 }}>
                            <Select
                              label="Fulfillment"
                              options={[
                                { label: "All fulfillment", value: "" },
                                { label: "Fulfilled", value: "fulfilled" },
                                { label: "Unfulfilled", value: "unfulfilled" },
                                { label: "Partial", value: "partial" },
                              ]}
                              value={fulfillmentValue}
                              onChange={setFulfillmentValue}
                            />
                          </div>
                          <div style={{ minWidth: 160 }}>
                            <Select
                              label="Payment"
                              options={[
                                { label: "All payments", value: "" },
                                { label: "Paid", value: "paid" },
                                { label: "Pending", value: "pending" },
                                { label: "Refunded", value: "refunded" },
                              ]}
                              value={paymentValue}
                              onChange={setPaymentValue}
                            />
                          </div>
                          <div style={{ minWidth: 140 }}>
                            <TextField
                              label="From date"
                              type="date"
                              value={dateFromValue}
                              onChange={setDateFromValue}
                              autoComplete="off"
                            />
                          </div>
                          <div style={{ minWidth: 140 }}>
                            <TextField
                              label="To date"
                              type="date"
                              value={dateToValue}
                              onChange={setDateToValue}
                              autoComplete="off"
                            />
                          </div>
                        </InlineStack>
                      </BlockStack>
                    </Box>

                    {/* Loading state */}
                    {isLoading && (
                      <Box paddingBlock="600">
                        <InlineStack align="center">
                          <Spinner size="large" />
                        </InlineStack>
                      </Box>
                    )}

                    {/* Empty state */}
                    {!isLoading && loadError && (
                      <Banner tone="critical" title="Couldn't load orders from Shopify">
                        <p>Please refresh the page. If this keeps happening, contact support.</p>
                      </Banner>
                    )}
                    {!isLoading && !loadError && orders.length === 0 && (
                      <EmptyState heading="No orders found" image="">
                        <p>
                          {searchQuery || hasActiveFilters
                            ? "No orders match the current filters."
                            : "No orders in your store yet."}
                        </p>
                      </EmptyState>
                    )}

                    {/* Table */}
                    {!isLoading && orders.length > 0 && (
                      <IndexTable
                        resourceName={{ singular: "order", plural: "orders" }}
                        itemCount={orders.length}
                        selectedItemsCount={selectedItems.size === orders.length ? "All" : selectedItems.size}
                        onSelectionChange={handleSelectionChange}
                        promotedBulkActions={[
                          {
                            content: bulkFetcher.state !== "idle" && bulkFetcher.formData?.get("intent") === "bulk-generate-pdf"
                              ? "Generating…"
                              : "Generate & Download PDFs",
                            onAction: handleBulkGeneratePDF,
                          },
                          {
                            content: bulkFetcher.state !== "idle" && bulkFetcher.formData?.get("intent") === "bulk-send-email"
                              ? "Sending…"
                              : "Send Invoice Emails",
                            onAction: handleBulkSendEmail,
                          },
                        ]}
                        headings={[
                          { title: "Order #" },
                          { title: "Date" },
                          { title: "Customer" },
                          { title: "Total" },
                          { title: "Payment" },
                          { title: "Fulfillment" },
                          { title: "Actions" },
                        ]}
                      >
                        {orderRowMarkup}
                      </IndexTable>
                    )}

                  </Box>
                )}

                {/* ── Credit Notes Tab ── */}
                {selectedTab === 1 && (
                  <Box>
                    {creditNotes.length === 0 ? (
                      <EmptyState heading="No credit notes found" image="">
                        <p>Credit notes are generated when refunds are issued.</p>
                      </EmptyState>
                    ) : (
                      <IndexTable
                        resourceName={{ singular: "credit note", plural: "credit notes" }}
                        itemCount={creditNotes.length}
                        headings={[
                          { title: "Credit Note #" },
                          { title: "Date" },
                          { title: "Order" },
                          { title: "Customer" },
                          { title: "Amount" },
                          { title: "Email" },
                          { title: "Actions" },
                        ]}
                        selectable={false}
                      >
                        {creditNoteRowMarkup}
                      </IndexTable>
                    )}
                  </Box>
                )}
              </Tabs>
            </Card>

            {/* Pagination — outside Card to avoid overflow:hidden clipping */}
            {selectedTab === 0 && (pageInfo.hasNextPage || pageInfo.hasPreviousPage) && (
              <div style={{
                position: "sticky", bottom: 0,
                background: "var(--p-color-bg-surface)",
                borderTop: "1px solid var(--p-color-border)",
                zIndex: 2,
              }}>
                <Box paddingBlock="300" paddingInline="400">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={pageInfo.hasPreviousPage}
                      onPrevious={handlePrevPage}
                      hasNext={pageInfo.hasNextPage}
                      onNext={handleNextPage}
                    />
                  </InlineStack>
                </Box>
              </div>
            )}
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
