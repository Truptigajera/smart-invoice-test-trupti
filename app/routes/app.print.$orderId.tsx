import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Checkbox,
  Divider,
  Box,
  Banner,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { generateAndSavePDF, generateCopyPDF, generatePackingSlipPDF } from "~/lib/pdf.server";
import { sendInvoiceEmail } from "~/lib/email.server";
import { ensureInvoiceExists } from "~/lib/order-invoice.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const numericOrderId = params.orderId!;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Fetch order name from Shopify
  let orderName = `#${numericOrderId}`;
  let shopifyAdminUrl = "";
  try {
    const res = await admin.graphql(
      `query($id: ID!) { order(id: $id) { id name legacyResourceId } }`,
      { variables: { id: `gid://shopify/Order/${numericOrderId}` } }
    );
    const data = await res.json();
    if (data.data?.order) {
      orderName = data.data.order.name;
      shopifyAdminUrl = `https://${shopDomain}/admin/orders/${numericOrderId}`;
    }
  } catch { /* fallback */ }

  // Tax invoice (Original, Duplicate, Triplicate)
  const invoice = await prisma.invoice.findFirst({
    where: { shopId: shop.id, orderId: numericOrderId, invoiceType: { not: "CREDIT_NOTE" } },
    select: { id: true, invoiceNumber: true, pdfUrl: true, buyerEmail: true, buyerName: true },
  });

  // Credit note
  const creditNote = await prisma.invoice.findFirst({
    where: { shopId: shop.id, orderId: numericOrderId, invoiceType: "CREDIT_NOTE" },
    select: { id: true, invoiceNumber: true, pdfUrl: true, buyerEmail: true, buyerName: true },
  });

  return json({
    shopId: shop.id,
    shopDomain,
    numericOrderId,
    orderName,
    shopifyAdminUrl,
    invoice,
    creditNote,
    emailSettings: {
      emailSubject: shop.settings?.emailSubject,
    },
  });
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const numericOrderId = params.orderId!;

  const shop = await prisma.shop.findUnique({ where: { shopDomain }, include: { settings: true } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "ensure-invoice") {
    try {
      const invoiceId = await ensureInvoiceExists(admin, shopDomain, shop.id, numericOrderId);
      if (!invoiceId) return json({ error: "Order not found in Shopify" }, { status: 404 });
      const pdfUrl = await generateAndSavePDF(invoiceId);
      const inv = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, invoiceNumber: true, buyerEmail: true, buyerName: true },
      });
      return json({ success: true, invoiceId, pdfUrl, invoice: inv });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (intent === "generate-copy") {
    const invoiceId = formData.get("invoiceId") as string;
    const copyType = formData.get("copyType") as "Duplicate" | "Triplicate";
    try {
      const pdfUrl = await generateCopyPDF(invoiceId, copyType);
      return json({ success: true, pdfUrl });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (intent === "generate-packing-slip") {
    const invoiceId = formData.get("invoiceId") as string;
    try {
      const pdfUrl = await generatePackingSlipPDF(invoiceId);
      return json({ success: true, pdfUrl });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (intent === "generate-credit-note-pdf") {
    const invoiceId = formData.get("invoiceId") as string;
    try {
      const pdfUrl = await generateAndSavePDF(invoiceId);
      return json({ success: true, pdfUrl });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (intent === "send-email") {
    const invoiceId = formData.get("invoiceId") as string;
    try {
      const inv = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { invoiceNumber: true, pdfUrl: true, buyerEmail: true, buyerName: true },
      });
      if (!inv?.pdfUrl || !inv.buyerEmail) {
        return json({ error: "Invoice missing PDF or email" }, { status: 400 });
      }
      await sendInvoiceEmail({
        shopId: shop.id,
        invoiceId,
        toEmail: inv.buyerEmail,
        toName: inv.buyerName || "Customer",
        invoiceNumber: inv.invoiceNumber,
        pdfUrl: inv.pdfUrl,
        subject: shop.settings?.emailSubject,
      });
      return json({ success: true, message: "Email sent!" });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ─── Document Section Component ───────────────────────────────────────────────

interface DocSectionProps {
  title: string;
  badge?: string;
  pdfUrl: string | null;
  invoiceId: string | null;
  invoiceNumber?: string | null;
  buyerEmail?: string | null;
  orderId: string;
  shopifyAdminUrl: string;
  intent: string;
  copyType?: "Duplicate" | "Triplicate";
  onPdfGenerated?: (pdfUrl: string, invoiceId?: string) => void;
}

function DocSection({
  title,
  badge,
  pdfUrl: initialPdfUrl,
  invoiceId: initialInvoiceId,
  invoiceNumber,
  buyerEmail,
  orderId,
  shopifyAdminUrl,
  intent,
  copyType,
  onPdfGenerated,
}: DocSectionProps) {
  const fetcher = useFetcher<{
    success?: boolean;
    pdfUrl?: string;
    invoiceId?: string;
    error?: string;
    message?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoice?: any;
  }>();
  const emailFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();

  const currentPdfUrl = (fetcher.data?.success && fetcher.data.pdfUrl) || initialPdfUrl;
  const currentInvoiceId = (fetcher.data?.invoiceId) || (fetcher.data?.invoice?.id) || initialInvoiceId;
  const isGenerating = fetcher.state !== "idle";
  const isSending = emailFetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.pdfUrl) {
      onPdfGenerated?.(fetcher.data.pdfUrl, fetcher.data.invoiceId || fetcher.data.invoice?.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const handleGenerate = useCallback(() => {
    if (intent === "ensure-invoice") {
      fetcher.submit({ intent: "ensure-invoice" }, { method: "POST" });
    } else if (copyType && currentInvoiceId) {
      fetcher.submit({ intent: "generate-copy", invoiceId: currentInvoiceId, copyType }, { method: "POST" });
    } else if (intent === "generate-packing-slip" && currentInvoiceId) {
      fetcher.submit({ intent: "generate-packing-slip", invoiceId: currentInvoiceId }, { method: "POST" });
    } else if (intent === "generate-credit-note-pdf" && currentInvoiceId) {
      fetcher.submit({ intent: "generate-credit-note-pdf", invoiceId: currentInvoiceId }, { method: "POST" });
    }
  }, [fetcher, intent, copyType, currentInvoiceId]);

  const handleSendEmail = useCallback(() => {
    if (!currentInvoiceId) return;
    emailFetcher.submit({ intent: "send-email", invoiceId: currentInvoiceId }, { method: "POST" });
  }, [emailFetcher, currentInvoiceId]);

  const handlePrint = useCallback(() => {
    if (currentPdfUrl) window.open(currentPdfUrl, "_blank");
  }, [currentPdfUrl]);

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">{title}</Text>
            {badge && <Badge>{badge}</Badge>}
            {invoiceNumber && (
              <Text as="span" variant="bodySm" tone="subdued">• {invoiceNumber}</Text>
            )}
          </InlineStack>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div onClick={(e) => e.stopPropagation()}>
            <InlineStack gap="200">
              {currentInvoiceId && (
                <Button size="slim" variant="plain" onClick={handleSendEmail} loading={isSending} disabled={isSending || !currentPdfUrl}>
                  Send Invoice
                </Button>
              )}
              <Button size="slim" variant="plain" url="/app/products" target="_self">
                Edit HSN &amp; GST
              </Button>
              {shopifyAdminUrl && (
                <Button size="slim" variant="plain" url={shopifyAdminUrl} target="_blank">
                  View Order
                </Button>
              )}
              <Button
                size="slim"
                variant="secondary"
                onClick={handlePrint}
                disabled={!currentPdfUrl || isGenerating}
              >
                Print
              </Button>
            </InlineStack>
          </div>
        </InlineStack>

        {/* Email feedback */}
        {emailFetcher.data?.success && (
          <Banner tone="success">{emailFetcher.data.message || "Email sent!"}</Banner>
        )}
        {emailFetcher.data?.error && (
          <Banner tone="critical">{emailFetcher.data.error}</Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}

        {/* PDF Preview */}
        {currentPdfUrl ? (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", background: "#f6f6f7" }}>
            <iframe
              src={currentPdfUrl}
              style={{ width: "100%", height: 640, border: "none", display: "block" }}
              title={title}
            />
          </div>
        ) : (
          <div style={{
            border: "2px dashed #c9cccf",
            borderRadius: 8,
            padding: "48px 24px",
            textAlign: "center",
            background: "#fafafa",
          }}>
            <BlockStack gap="300" align="center">
              <Text as="p" variant="bodyMd" tone="subdued">
                {isGenerating ? "Generating PDF…" : "No PDF generated yet"}
              </Text>
              {isGenerating ? (
                <InlineStack align="center"><Spinner size="small" /></InlineStack>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={!currentInvoiceId && intent !== "ensure-invoice"}
                >
                  Generate PDF
                </Button>
              )}
            </BlockStack>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PrintPage() {
  const { numericOrderId, orderName, shopifyAdminUrl, invoice, creditNote } =
    useLoaderData<typeof loader>();

  // Local state for invoice / packing slip URLs (updated after generation)
  const [invoiceState, setInvoiceState] = useState<{
    id: string | null;
    pdfUrl: string | null;
    invoiceNumber: string | null;
    buyerEmail: string | null;
  }>({
    id: invoice?.id ?? null,
    pdfUrl: invoice?.pdfUrl ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
    buyerEmail: invoice?.buyerEmail ?? null,
  });

  const [dupPdfUrl, setDupPdfUrl] = useState<string | null>(null);
  const [triPdfUrl, setTriPdfUrl] = useState<string | null>(null);
  const [packingSlipUrl, setPackingSlipUrl] = useState<string | null>(null);

  // Sidebar print selections — default: Invoice + Original only
  const [printInvoice, setPrintInvoice] = useState(true);
  const [printRefund, setPrintRefund] = useState(false);
  const [printPackingSlip, setPrintPackingSlip] = useState(false);
  const [printOriginal, setPrintOriginal] = useState(true);
  const [printDuplicate, setPrintDuplicate] = useState(false);
  const [printTriplicate, setPrintTriplicate] = useState(false);

  const handleInvoiceGenerated = useCallback((pdfUrl: string, invoiceId?: string) => {
    setInvoiceState((prev) => ({
      ...prev,
      id: invoiceId || prev.id,
      pdfUrl,
    }));
  }, []);

  const handlePrintAll = useCallback(() => {
    const urls: string[] = [];
    if (printInvoice) {
      if (printOriginal && invoiceState.pdfUrl) urls.push(invoiceState.pdfUrl);
      if (printDuplicate && dupPdfUrl) urls.push(dupPdfUrl);
      if (printTriplicate && triPdfUrl) urls.push(triPdfUrl);
    }
    if (printRefund && creditNote?.pdfUrl) urls.push(creditNote.pdfUrl);
    if (printPackingSlip && packingSlipUrl) urls.push(packingSlipUrl);

    if (urls.length === 0) {
      alert("No PDFs selected or generated yet. Please generate PDFs first.");
      return;
    }
    urls.forEach((url) => window.open(url, "_blank"));
  }, [printInvoice, printOriginal, printDuplicate, printTriplicate, printRefund, printPackingSlip,
    invoiceState.pdfUrl, dupPdfUrl, triPdfUrl, creditNote?.pdfUrl, packingSlipUrl]);

  return (
    <Page
      title={`Print — ${orderName}`}
      backAction={{ content: "Orders", url: "/app/orders" }}
    >
      <TitleBar title={`Print — ${orderName}`} />
      <Layout>
        {/* ── Main Content ── */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* 1. Invoice – Original */}
            {printInvoice && printOriginal && (
              <DocSection
                title="1. Invoice – original"
                badge="Original"
                pdfUrl={invoiceState.pdfUrl}
                invoiceId={invoiceState.id}
                invoiceNumber={invoiceState.invoiceNumber}
                buyerEmail={invoiceState.buyerEmail}
                orderId={numericOrderId}
                shopifyAdminUrl={shopifyAdminUrl}
                intent="ensure-invoice"
                onPdfGenerated={handleInvoiceGenerated}
              />
            )}

            {/* 2. Invoice – Duplicate */}
            {printInvoice && printDuplicate && (
              <DocSection
                title="2. Invoice – duplicate"
                badge="Duplicate"
                pdfUrl={dupPdfUrl}
                invoiceId={invoiceState.id}
                invoiceNumber={invoiceState.invoiceNumber}
                orderId={numericOrderId}
                shopifyAdminUrl={shopifyAdminUrl}
                intent="generate-copy"
                copyType="Duplicate"
                onPdfGenerated={(url) => setDupPdfUrl(url)}
              />
            )}

            {/* 3. Invoice – Triplicate */}
            {printInvoice && printTriplicate && (
              <DocSection
                title="3. Invoice – triplicate"
                badge="Triplicate"
                pdfUrl={triPdfUrl}
                invoiceId={invoiceState.id}
                invoiceNumber={invoiceState.invoiceNumber}
                orderId={numericOrderId}
                shopifyAdminUrl={shopifyAdminUrl}
                intent="generate-copy"
                copyType="Triplicate"
                onPdfGenerated={(url) => setTriPdfUrl(url)}
              />
            )}

            {/* 4. Refund / Credit Note */}
            {printRefund && (
              creditNote ? (
                <DocSection
                  title="4. Refund / Credit Note"
                  pdfUrl={creditNote.pdfUrl ?? null}
                  invoiceId={creditNote.id}
                  invoiceNumber={creditNote.invoiceNumber}
                  buyerEmail={creditNote.buyerEmail}
                  orderId={numericOrderId}
                  shopifyAdminUrl={shopifyAdminUrl}
                  intent="generate-credit-note-pdf"
                />
              ) : (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">4. Refund / Credit Note</Text>
                    <Banner tone="info">
                      No credit note for this order. Credit notes are generated automatically when a refund is issued in Shopify.
                    </Banner>
                  </BlockStack>
                </Card>
              )
            )}

            {/* 5. Packing Slip */}
            {printPackingSlip && (
              <DocSection
                title="5. Packing Slip"
                pdfUrl={packingSlipUrl}
                invoiceId={invoiceState.id}
                invoiceNumber={null}
                orderId={numericOrderId}
                shopifyAdminUrl={shopifyAdminUrl}
                intent="generate-packing-slip"
                onPdfGenerated={(url) => setPackingSlipUrl(url)}
              />
            )}

            {/* Fallback: nothing selected */}
            {!printInvoice && !printRefund && !printPackingSlip && (
              <Card>
                <Box padding="800">
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    Select at least one template from the sidebar to view documents.
                  </Text>
                </Box>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        {/* ── Sidebar ── */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Templates selection */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">Templates</Text>
                <BlockStack gap="200">
                  <Checkbox
                    label="Invoice"
                    checked={printInvoice}
                    onChange={setPrintInvoice}
                  />
                  <Checkbox
                    label="Refund / Credit Note"
                    checked={printRefund}
                    onChange={setPrintRefund}
                  />
                  <Checkbox
                    label="Packing Slip"
                    checked={printPackingSlip}
                    onChange={setPrintPackingSlip}
                  />
                </BlockStack>

                <Divider />

                <Text as="h3" variant="headingSm">Select invoice types</Text>
                <BlockStack gap="200">
                  <Checkbox
                    label="Original"
                    checked={printOriginal}
                    onChange={setPrintOriginal}
                    disabled={!printInvoice}
                  />
                  <Checkbox
                    label="Duplicate"
                    checked={printDuplicate}
                    onChange={setPrintDuplicate}
                    disabled={!printInvoice}
                  />
                  <Checkbox
                    label="Triplicate"
                    checked={printTriplicate}
                    onChange={setPrintTriplicate}
                    disabled={!printInvoice}
                  />
                </BlockStack>

                <Button variant="primary" fullWidth onClick={handlePrintAll}>
                  Print
                </Button>
              </BlockStack>
            </Card>

            {/* Custom template promo */}
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Custom invoice template?</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Customize fonts, colors, fields, and layout to match your brand.
                </Text>
                <Button url="/app/templates" variant="plain" fullWidth>
                  Customize Templates →
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
