import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, Divider, Box, DataTable, Banner, Spinner, TextField, Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { PlanGate } from "~/components/PlanGate";
import { generateInvoicePDF, generateAndSavePDF } from "~/lib/pdf.server";
import { sendInvoiceEmail } from "~/lib/email.server";
import { generateIRN, cancelIRN } from "~/lib/einvoice.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, include: { settings: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, shopId: shop.id },
    include: { lineItems: true, emailLogs: { orderBy: { createdAt: "desc" }, take: 5 } },
  });

  if (!invoice) throw new Response("Invoice not found", { status: 404 });

  const customFieldDefs = (() => {
    try { return JSON.parse((shop.settings as any)?.customFields || "[]"); } catch { return []; }
  })();

  return json({ invoice, shopDomain: shop.shopDomain, customFieldDefs, currentPlan: shop.currentPlan });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, shopId: shop.id },
  });
  if (!invoice) return json({ error: "Invoice not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Generate PDF buffer and return as base64 (download or preview)
  if (intent === "download-pdf" || intent === "preview-pdf") {
    const copyType = (formData.get("copyType") as string || "Original") as "Original" | "Duplicate" | "Triplicate";
    try {
      const buffer = await generateInvoicePDF(invoice.id, copyType);
      const suffix = copyType !== "Original" ? `-${copyType}` : "";
      const filename = `Invoice-${invoice.invoiceNumber}${suffix}.pdf`;
      return json({ success: true, pdfBase64: buffer.toString("base64"), filename });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // Send email with on-the-fly PDF attachment
  if (intent === "send-email") {
    if (!invoice.buyerEmail) return json({ error: "No email address for this buyer." });
    try {
      const buffer = await generateInvoicePDF(invoice.id, "Original");
      await sendInvoiceEmail({
        shopId: shop.id,
        invoiceId: invoice.id,
        toEmail: invoice.buyerEmail,
        toName: invoice.buyerName || "Customer",
        invoiceNumber: invoice.invoiceNumber,
        pdfBuffer: buffer,
        subject: shop.settings?.emailSubject,
      });
      return json({ success: `Invoice emailed to ${invoice.buyerEmail}` });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // Generate & save PDF, return WhatsApp deep-link to client
  if (intent === "whatsapp-share") {
    if (!canUseFeature(shop.currentPlan, "whatsapp")) {
      return json({ error: "WhatsApp sharing requires the Pro plan. Please upgrade." }, { status: 403 });
    }
    try {
      const pdfRelUrl = await generateAndSavePDF(invoice.id);
      const origin = new URL(request.url).origin;
      const pdfUrl = `${origin}${pdfRelUrl}`;

      // Normalise Indian phone → 91XXXXXXXXXX
      let phone = "";
      if (invoice.buyerPhone) {
        const d = invoice.buyerPhone.replace(/\D/g, "");
        if (d.length === 10) phone = `91${d}`;
        else if (d.length === 11 && d.startsWith("0")) phone = `91${d.slice(1)}`;
        else if (d.length === 12 && d.startsWith("91")) phone = d;
        else phone = d;
      }

      const name = invoice.buyerName || "Customer";
      const amount = `₹${invoice.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const shopName = (shop as any).businessName || shop.shopDomain;
      const msg = `Dear ${name},\n\nYour invoice *${invoice.invoiceNumber}* for ${amount} is ready.\n\n📄 Download: ${pdfUrl}\n\nThank you!\n- ${shopName}`;

      const waUrl = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
        : `https://wa.me/?text=${encodeURIComponent(msg)}`;

      return json({ whatsappUrl: waUrl });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "PDF generation failed" }, { status: 500 });
    }
  }

  // Save custom field values for this invoice
  if (intent === "save-custom-fields") {
    const values = formData.get("customFieldValues") as string || "{}";
    await prisma.invoice.update({ where: { id: invoice.id }, data: { customFieldValues: values } });
    return json({ successCustomFields: "Custom fields saved!" });
  }

  // Generate E-Invoice IRN via NIC IRP
  if (intent === "generate-irn") {
    if (!canUseFeature(shop.currentPlan, "einvoice")) {
      return json({ error: "E-Invoice (IRN) requires the Pro plan. Please upgrade." }, { status: 403 });
    }
    try {
      const result = await generateIRN(invoice.id, shop.id);
      return json({ irnSuccess: `IRN generated successfully! ACK: ${result.ackNo}` });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "IRN generation failed" }, { status: 500 });
    }
  }

  // Cancel E-Invoice IRN
  if (intent === "cancel-irn") {
    const reason = formData.get("cancelReason") as string || "4";
    const remark = formData.get("cancelRemark") as string || "Cancelled";
    try {
      await cancelIRN(invoice.id, shop.id, reason, remark);
      return json({ irnSuccess: "IRN cancelled successfully." });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "IRN cancellation failed" }, { status: 500 });
    }
  }

  return json({ error: "Unknown action" });
};

// Trigger browser PDF download from base64 string
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

export default function InvoiceDetailPage() {
  const navigate = useNavigate();
  const { invoice, customFieldDefs, currentPlan } = useLoaderData<typeof loader>();

  const downloadFetcher = useFetcher<{ success?: boolean; pdfBase64?: string; filename?: string; error?: string }>();
  const previewFetcher = useFetcher<{ success?: boolean; pdfBase64?: string; error?: string }>();
  const emailFetcher = useFetcher<{ success?: string; error?: string }>();
  const whatsappFetcher = useFetcher<{ whatsappUrl?: string; error?: string }>();
  const cfFetcher  = useFetcher<{ successCustomFields?: string; error?: string }>();
  const irnFetcher = useFetcher<{ irnSuccess?: string; error?: string }>();
  const [cancelReason, setCancelReason] = useState("4");
  const [cancelRemark, setCancelRemark] = useState("");
  const [showCancelIRN, setShowCancelIRN] = useState(false);
  const isIRNLoading = irnFetcher.state !== "idle";

  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [downloadingCopyType, setDownloadingCopyType] = useState<string | null>(null);

  // Custom field values state — initialise from DB
  const [cfValues, setCfValues] = useState<Record<string, string>>(() => {
    try { return JSON.parse((invoice as any).customFieldValues || "{}"); } catch { return {}; }
  });

  const isDownloading = downloadFetcher.state !== "idle";
  const isPreviewing = previewFetcher.state !== "idle";
  const isSending = emailFetcher.state !== "idle";
  const isWhatsApping = whatsappFetcher.state !== "idle";

  // Trigger download exactly once when new base64 data arrives
  useEffect(() => {
    if (downloadFetcher.data?.pdfBase64 && downloadFetcher.data?.filename) {
      triggerPdfDownload(downloadFetcher.data.pdfBase64, downloadFetcher.data.filename);
    }
  }, [downloadFetcher.data]);

  // Reset the active button only when the fetcher goes back to idle
  useEffect(() => {
    if (downloadFetcher.state === "idle") setDownloadingCopyType(null);
  }, [downloadFetcher.state]);

  // Build blob URL for inline preview
  useEffect(() => {
    if (previewFetcher.data?.pdfBase64) {
      const bytes = Uint8Array.from(atob(previewFetcher.data.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      setPreviewLoaded(true);
    }
  }, [previewFetcher.data]);

  // Open WhatsApp when server returns the deep-link
  useEffect(() => {
    if (whatsappFetcher.data?.whatsappUrl) {
      window.open(whatsappFetcher.data.whatsappUrl, "_blank");
    }
  }, [whatsappFetcher.data]);

  const handleDownload = useCallback((copyType = "Original") => {
    setDownloadingCopyType(copyType);
    downloadFetcher.submit({ intent: "download-pdf", copyType }, { method: "POST" });
  }, [downloadFetcher]);

  const handlePreview = useCallback(() => {
    setPreviewLoaded(false);
    previewFetcher.submit({ intent: "preview-pdf", copyType: "Original" }, { method: "POST" });
  }, [previewFetcher]);

  const handleSendEmail = useCallback(() => {
    emailFetcher.submit({ intent: "send-email" }, { method: "POST" });
  }, [emailFetcher]);

  const handleWhatsApp = useCallback(() => {
    whatsappFetcher.submit({ intent: "whatsapp-share" }, { method: "POST" });
  }, [whatsappFetcher]);

  const formatRs = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  const isIGST = invoice.taxType === "IGST";

  const lineItemRows = invoice.lineItems.map((item) => [
    item.productName + (item.variantName ? `\n${item.variantName}` : ""),
    item.hsnCode || "-",
    `${item.quantity} ${item.unit}`,
    formatRs(item.unitPrice),
    formatRs(item.taxableValue),
    isIGST
      ? `${item.igstRate}%\n${formatRs(item.igstAmount)}`
      : `${item.cgstRate}%+${item.sgstRate}%\n${formatRs(item.cgstAmount + item.sgstAmount)}`,
    formatRs(item.totalAmount),
  ]);

  return (
    <Page
      title={`Invoice ${invoice.invoiceNumber}`}
      backAction={{ content: "Invoices", url: "/app/invoices" }}
      primaryAction={{
        content: downloadingCopyType === "Original" && isDownloading ? "Preparing…" : "Download PDF",
        onAction: () => handleDownload("Original"),
        loading: downloadingCopyType === "Original" && isDownloading,
      }}
      secondaryActions={[
        ...(invoice.buyerEmail
          ? [{
              content: isSending ? "Sending…" : "Send Email",
              onAction: handleSendEmail,
              loading: isSending,
            }]
          : []),
        {
          content: isWhatsApping ? "Preparing…" : canUseFeature(currentPlan, "whatsapp") ? "Share on WhatsApp" : "WhatsApp [Pro]",
          onAction: canUseFeature(currentPlan, "whatsapp") ? handleWhatsApp : () => navigate("/app/billing"),
          loading: isWhatsApping,
        },
        {
          content: isPreviewing ? "Loading…" : previewLoaded ? "Refresh Preview" : "Preview PDF",
          onAction: handlePreview,
          loading: isPreviewing,
        },
      ]}
    >
      <TitleBar title={`Invoice ${invoice.invoiceNumber}`} />

      <BlockStack gap="400">
        {/* Feedback banners */}
        {downloadFetcher.data?.error && (
          <Banner tone="critical">{downloadFetcher.data.error}</Banner>
        )}
        {emailFetcher.data?.error && (
          <Banner tone="critical">{emailFetcher.data.error}</Banner>
        )}
        {emailFetcher.data?.success && (
          <Banner tone="success">{emailFetcher.data.success}</Banner>
        )}
        {previewFetcher.data?.error && (
          <Banner tone="critical">{previewFetcher.data.error}</Banner>
        )}
        {whatsappFetcher.data?.error && (
          <Banner tone="critical">{whatsappFetcher.data.error}</Banner>
        )}

        {/* Status Badges */}
        <InlineStack gap="200">
          <Badge tone={invoice.invoiceType === "CREDIT_NOTE" ? "warning" : "success"}>
            {invoice.invoiceType === "CREDIT_NOTE" ? "Credit Note" : "Tax Invoice"}
          </Badge>
          <Badge tone={invoice.supplyType === "B2B" ? "info" : "attention"}>{invoice.supplyType}</Badge>
          <Badge tone={invoice.taxType === "IGST" ? "attention" : "info"}>
            {invoice.taxType === "IGST" ? "IGST" : "CGST + SGST"}
          </Badge>
          {invoice.emailSentAt ? (
            <Badge tone="success">{`Email Sent ${formatDate(invoice.emailSentAt)}`}</Badge>
          ) : (
            <Badge>Email Not Sent</Badge>
          )}
        </InlineStack>

        <Layout>
          {/* Invoice Info */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Invoice Details</Text>
                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Invoice #</Text>
                    <Text as="span" fontWeight="semibold">{invoice.invoiceNumber}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Date</Text>
                    <Text as="span">{formatDate(invoice.invoiceDate)}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Place of Supply</Text>
                    <Text as="span">{invoice.placeOfSupply || "-"}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Order</Text>
                    <Text as="span">{invoice.orderName || "-"}</Text>
                  </InlineStack>
                  {invoice.reverseCharge && (
                    <Text as="p" tone="critical">⚠ Reverse Charge Applicable</Text>
                  )}
                  {invoice.irn && (
                    <>
                      <Divider />
                      <Text as="p" variant="bodySm" tone="subdued">IRN: {invoice.irn}</Text>
                    </>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Buyer Info */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Buyer Details</Text>
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">{invoice.buyerName || "Guest Customer"}</Text>
                  {invoice.buyerGstin && <Text as="p" tone="subdued">GSTIN: {invoice.buyerGstin}</Text>}
                  {invoice.buyerAddress && <Text as="p" tone="subdued">{invoice.buyerAddress}</Text>}
                  {(invoice.buyerCity || invoice.buyerState) && (
                    <Text as="p" tone="subdued">
                      {[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}
                    </Text>
                  )}
                  {invoice.buyerEmail && <Text as="p" tone="subdued">{invoice.buyerEmail}</Text>}
                  {invoice.buyerPhone && <Text as="p" tone="subdued">{invoice.buyerPhone}</Text>}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Amount Summary */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Amount Summary</Text>
                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Subtotal</Text>
                    <Text as="span">{formatRs(invoice.subTotal)}</Text>
                  </InlineStack>
                  {invoice.discountAmount > 0 && (
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Discount</Text>
                      <Text as="span">- {formatRs(invoice.discountAmount)}</Text>
                    </InlineStack>
                  )}
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Taxable</Text>
                    <Text as="span">{formatRs(invoice.taxableAmount)}</Text>
                  </InlineStack>
                  <Divider />
                  {isIGST ? (
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">IGST</Text>
                      <Text as="span">{formatRs(invoice.igstAmount)}</Text>
                    </InlineStack>
                  ) : (
                    <>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">CGST</Text>
                        <Text as="span">{formatRs(invoice.cgstAmount)}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">SGST</Text>
                        <Text as="span">{formatRs(invoice.sgstAmount)}</Text>
                      </InlineStack>
                    </>
                  )}
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" fontWeight="bold">Grand Total</Text>
                    <Text as="span" fontWeight="bold" variant="headingMd">{formatRs(invoice.totalAmount)}</Text>
                  </InlineStack>
                  {invoice.amountInWords && (
                    <Text as="p" variant="bodySm" tone="subdued">{invoice.amountInWords}</Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Line Items */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Line Items</Text>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
              headings={["Item", "HSN/SAC", "Qty", "Rate", "Taxable", isIGST ? "IGST" : "CGST+SGST", "Total"]}
              rows={lineItemRows}
            />
          </BlockStack>
        </Card>

        {/* PDF Preview */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">PDF Preview</Text>
              <InlineStack gap="200">
                {["Original", "Duplicate", "Triplicate"].map((ct) => (
                  <Button
                    key={ct}
                    size="slim"
                    variant="secondary"
                    onClick={() => handleDownload(ct)}
                    loading={isDownloading && downloadingCopyType === ct}
                    disabled={isDownloading && downloadingCopyType !== ct}
                  >
                    ↓ {ct}
                  </Button>
                ))}
              </InlineStack>
            </InlineStack>

            {isPreviewing && (
              <Box padding="800">
                <InlineStack align="center">
                  <BlockStack gap="200" align="center">
                    <Spinner size="large" />
                    <Text as="p" tone="subdued" alignment="center">Generating preview…</Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            )}

            {previewLoaded && previewBlobUrl && !isPreviewing && (
              <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", background: "#f6f6f7" }}>
                <iframe
                  src={previewBlobUrl}
                  style={{ width: "100%", height: 700, border: "none", display: "block" }}
                  title={`Invoice ${invoice.invoiceNumber} Preview`}
                />
              </div>
            )}

            {!previewLoaded && !isPreviewing && (
              <div style={{
                border: "2px dashed #c9cccf",
                borderRadius: 8,
                padding: "48px 24px",
                textAlign: "center",
                background: "#fafafa",
              }}>
                <BlockStack gap="300" align="center">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Click &ldquo;Preview PDF&rdquo; to load the invoice preview
                  </Text>
                  <Button variant="primary" onClick={handlePreview}>
                    Preview PDF
                  </Button>
                </BlockStack>
              </div>
            )}
          </BlockStack>
        </Card>

        {/* Custom Fields */}
        {customFieldDefs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Custom Fields</Text>
              {cfFetcher.data?.successCustomFields && (
                <Banner tone="success">{cfFetcher.data.successCustomFields}</Banner>
              )}
              {cfFetcher.data?.error && (
                <Banner tone="critical">{cfFetcher.data.error}</Banner>
              )}
              {customFieldDefs.map((field: { key: string; label: string; type: string }) => (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={cfValues[field.key] || ""}
                  onChange={(v) => setCfValues({ ...cfValues, [field.key]: v })}
                  type={field.type === "number" ? "number" : "text"}
                  autoComplete="off"
                />
              ))}
              <InlineStack>
                <Button
                  variant="primary"
                  size="slim"
                  loading={cfFetcher.state !== "idle"}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save-custom-fields");
                    fd.append("customFieldValues", JSON.stringify(cfValues));
                    cfFetcher.submit(fd, { method: "POST" });
                  }}
                >
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* E-Invoice (IRN) */}
        <PlanGate currentPlan={currentPlan} feature="einvoice">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">E-Invoice (IRN)</Text>
              {invoice.irn && (
                <Badge tone={invoice.irnStatus === "CANCELLED" ? "critical" : "success"}>
                  {invoice.irnStatus === "CANCELLED" ? "Cancelled" : "Generated"}
                </Badge>
              )}
            </InlineStack>

            {irnFetcher.data?.irnSuccess && (
              <Banner tone="success">{irnFetcher.data.irnSuccess}</Banner>
            )}
            {irnFetcher.data?.error && (
              <Banner tone="critical">{irnFetcher.data.error}</Banner>
            )}

            {invoice.irn ? (
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">IRN</Text>
                  <Text as="span" variant="bodySm" breakWord>{invoice.irn}</Text>
                </InlineStack>
                {(invoice as any).ackNo && (
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">ACK No</Text>
                    <Text as="span">{(invoice as any).ackNo}</Text>
                  </InlineStack>
                )}
                {(invoice as any).ackDate && (
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">ACK Date</Text>
                    <Text as="span">{(invoice as any).ackDate}</Text>
                  </InlineStack>
                )}

                {invoice.irnStatus !== "CANCELLED" && (
                  <>
                    {!showCancelIRN ? (
                      <InlineStack>
                        <Button
                          tone="critical"
                          size="slim"
                          onClick={() => setShowCancelIRN(true)}
                        >
                          Cancel IRN
                        </Button>
                      </InlineStack>
                    ) : (
                      <BlockStack gap="200">
                        <Select
                          label="Cancellation Reason"
                          options={[
                            { label: "Duplicate",           value: "1" },
                            { label: "Data Entry Mistake",  value: "2" },
                            { label: "Order Cancelled",     value: "3" },
                            { label: "Other",               value: "4" },
                          ]}
                          value={cancelReason}
                          onChange={setCancelReason}
                        />
                        <TextField
                          label="Remark"
                          value={cancelRemark}
                          onChange={setCancelRemark}
                          autoComplete="off"
                          placeholder="Brief reason for cancellation"
                        />
                        <InlineStack gap="200">
                          <Button
                            tone="critical"
                            size="slim"
                            loading={isIRNLoading}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent",       "cancel-irn");
                              fd.append("cancelReason", cancelReason);
                              fd.append("cancelRemark", cancelRemark || "Cancelled");
                              irnFetcher.submit(fd, { method: "POST" });
                              setShowCancelIRN(false);
                            }}
                          >
                            Confirm Cancel
                          </Button>
                          <Button size="slim" onClick={() => setShowCancelIRN(false)}>
                            Back
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </>
                )}
              </BlockStack>
            ) : (
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Generate an IRN for this invoice via the NIC Invoice Registration Portal.
                  E-Invoice is required for B2B transactions above the turnover threshold.
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    size="slim"
                    loading={isIRNLoading}
                    onClick={() => {
                      irnFetcher.submit({ intent: "generate-irn" }, { method: "POST" });
                    }}
                  >
                    Generate E-Invoice (IRN)
                  </Button>
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
        </PlanGate>

        {/* Email History */}
        {invoice.emailLogs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Email History</Text>
              {invoice.emailLogs.map((log) => (
                <InlineStack key={log.id} align="space-between" blockAlign="center">
                  <BlockStack gap="0">
                    <Text as="span" variant="bodySm">{log.sentTo}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{log.subject}</Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={log.status === "sent" ? "success" : log.status === "failed" ? "critical" : "attention"}>
                      {log.status}
                    </Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {formatDate(log.createdAt)}
                    </Text>
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
