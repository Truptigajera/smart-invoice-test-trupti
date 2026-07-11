import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Button, Select,
  RangeSlider, TextField, Checkbox, Divider, Badge, Box, Banner, Tabs,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { renderLiquidTemplate, invoiceToScope } from "~/lib/liquid.server";
import type { InvoiceData } from "~/components/invoice-pdf-types";
import { DEFAULT_HTML_TEMPLATE } from "~/lib/template-defaults";
import type {
  BrandingSettings, OverviewSettings, AddressSettings,
  LineItemsSettings, NotesSettings, TotalsSettings, FooterSettings, LabelsSettings,
} from "~/lib/customization.types";
import {
  DEFAULT_BRANDING, DEFAULT_OVERVIEW, DEFAULT_ADDRESS,
  DEFAULT_LINE_ITEMS, DEFAULT_NOTES, DEFAULT_TOTALS, DEFAULT_FOOTER, DEFAULT_LABELS,
  mergeDefaults,
} from "~/lib/customization.types";

// Lazy-load CodeMirror bundle (heavy — only used in Code Editor mode)
const CodeMirrorBundle = lazy(async () => {
  const [{ default: CodeMirror }, { html }] = await Promise.all([
    import("@uiw/react-codemirror"),
    import("@codemirror/lang-html"),
  ]);
  function EditorWrapper(props: { value: string; onChange: (v: string) => void }) {
    return (
      <CodeMirror
        value={props.value}
        height="600px"
        extensions={[html()]}
        theme="dark"
        onChange={props.onChange}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
        style={{ fontSize: 12, fontFamily: "monospace" }}
      />
    );
  }
  return { default: EditorWrapper };
});

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const templateId = params.templateId!;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const existing = await prisma.templateCustomization.findUnique({
    where: { shopId_templateId: { shopId: shop.id, templateId } },
  });

  // Fetch recent orders for preview selector
  const recentInvoices = await prisma.invoice.findMany({
    where: { shopId: shop.id, invoiceType: { not: "CREDIT_NOTE" } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, invoiceNumber: true, orderName: true, pdfUrl: true },
  });

  return json({
    shopId: shop.id,
    shopDomain,
    templateId,
    shopLogoUrl: shop.logoUrl,
    shopSignatureUrl: shop.signatureUrl,
    customHtmlTemplate: existing?.customHtmlTemplate ?? null,
    saved: existing
      ? {
          branding: existing.branding as Partial<BrandingSettings> | null,
          overview: existing.overview as Partial<OverviewSettings> | null,
          address: existing.address as Partial<AddressSettings> | null,
          lineItems: existing.lineItems as Partial<LineItemsSettings> | null,
          notes: existing.notes as Partial<NotesSettings> | null,
          totals: existing.totals as Partial<TotalsSettings> | null,
          footer: existing.footer as Partial<FooterSettings> | null,
          labels: existing.labels as Partial<LabelsSettings> | null,
        }
      : null,
    recentInvoices,
  });
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const templateId = params.templateId!;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save") {
    const branding = JSON.parse(formData.get("branding") as string || "{}");
    const overview = JSON.parse(formData.get("overview") as string || "{}");
    const address = JSON.parse(formData.get("address") as string || "{}");
    const lineItems = JSON.parse(formData.get("lineItems") as string || "{}");
    const notes = JSON.parse(formData.get("notes") as string || "{}");
    const totals = JSON.parse(formData.get("totals") as string || "{}");
    const footer = JSON.parse(formData.get("footer") as string || "{}");
    const labels = JSON.parse(formData.get("labels") as string || "{}");

    await prisma.templateCustomization.upsert({
      where: { shopId_templateId: { shopId: shop.id, templateId } },
      create: { shopId: shop.id, templateId, branding, overview, address, lineItems, notes, totals, footer, labels },
      update: { branding, overview, address, lineItems, notes, totals, footer, labels, updatedAt: new Date() },
    });

    return json({ success: true, message: "Customization saved!" });
  }

  if (intent === "saveTemplate") {
    const customHtmlTemplate = formData.get("customHtmlTemplate") as string;
    await prisma.templateCustomization.upsert({
      where: { shopId_templateId: { shopId: shop.id, templateId } },
      create: { shopId: shop.id, templateId, customHtmlTemplate },
      update: { customHtmlTemplate, updatedAt: new Date() },
    });
    return json({ success: true, message: "Custom template saved!" });
  }

  if (intent === "preview") {
    const templateCode = formData.get("templateCode") as string;
    const invoiceId = formData.get("invoiceId") as string | null;

    const invoice = await prisma.invoice.findFirst({
      where: {
        shopId: shop.id,
        invoiceType: { not: "CREDIT_NOTE" },
        ...(invoiceId ? { id: invoiceId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { lineItems: true, shop: { include: { settings: true } } },
    });

    if (!invoice) {
      return json({ html: "<p style='padding:20px;color:#888'>No invoices yet — save an order first to preview.</p>" });
    }

    try {
      const scope = invoiceToScope(invoice as unknown as InvoiceData, "Original");
      const html = await renderLiquidTemplate(templateCode, scope, invoice.shop.settings as any);
      return json({ html });
    } catch (err: any) {
      return json({ html: `<p style='padding:20px;color:red;font-family:monospace'>Template error: ${err?.message || err}</p>` });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ─── Template name map ────────────────────────────────────────────────────────

const TEMPLATE_NAMES: Record<string, string> = {
  "template-1": "Classic",
  "template-2": "Bold",
  "template-3": "Sharp",
  "template-4": "Celestial",
  "template-5": "Oasis",
  "template-6": "Orbix",
};

// ─── Section Components ───────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <BlockStack gap="050">
      <Text as="h3" variant="headingSm">{title}</Text>
      {subtitle && <Text as="p" variant="bodySm" tone="subdued">{subtitle}</Text>}
    </BlockStack>
  );
}

function ToggleRow({ label, checked, onChange, helpText }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; helpText?: string;
}) {
  return (
    <Checkbox label={label} checked={checked} onChange={onChange} helpText={helpText} />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TemplateCusomizerPage() {
  const { templateId, shopSignatureUrl, saved, recentInvoices, customHtmlTemplate } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const previewFetcher = useFetcher<{ html?: string }>();
  const navigate = useNavigate();

  const templateName = TEMPLATE_NAMES[templateId] || templateId;

  // ── Editor mode toggle ──
  const [editorMode, setEditorMode] = useState<"customize" | "code">("customize");
  const [templateCode, setTemplateCode] = useState<string>(
    customHtmlTemplate || DEFAULT_HTML_TEMPLATE
  );

  const handlePreview = useCallback(() => {
    previewFetcher.submit(
      { intent: "preview", templateCode, invoiceId: recentInvoices[0]?.id || "" },
      { method: "POST" }
    );
  }, [previewFetcher, templateCode, recentInvoices]);

  const handleSaveTemplate = useCallback(() => {
    fetcher.submit(
      { intent: "saveTemplate", customHtmlTemplate: templateCode },
      { method: "POST" }
    );
  }, [fetcher, templateCode]);

  // Auto-preview when switching to code editor mode
  useEffect(() => {
    if (editorMode === "code" && !previewFetcher.data?.html) {
      handlePreview();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  // ── State: all settings sections ──
  const [branding, setBranding] = useState<BrandingSettings>(() =>
    mergeDefaults(saved?.branding, DEFAULT_BRANDING)
  );
  const [overview, setOverview] = useState<OverviewSettings>(() =>
    mergeDefaults(saved?.overview, DEFAULT_OVERVIEW)
  );
  const [address, setAddress] = useState<AddressSettings>(() =>
    mergeDefaults(saved?.address, DEFAULT_ADDRESS)
  );
  const [lineItems, setLineItems] = useState<LineItemsSettings>(() =>
    mergeDefaults(saved?.lineItems, DEFAULT_LINE_ITEMS)
  );
  const [notes, setNotes] = useState<NotesSettings>(() =>
    mergeDefaults(saved?.notes, DEFAULT_NOTES)
  );
  const [totals, setTotals] = useState<TotalsSettings>(() =>
    mergeDefaults(saved?.totals, DEFAULT_TOTALS)
  );
  const [footer, setFooter] = useState<FooterSettings>(() =>
    mergeDefaults(saved?.footer, DEFAULT_FOOTER)
  );
  const [labels, setLabels] = useState<LabelsSettings>(() =>
    mergeDefaults(saved?.labels, DEFAULT_LABELS)
  );

  const [activeTab, setActiveTab] = useState(0);
  const [previewInvoiceId, setPreviewInvoiceId] = useState(recentInvoices[0]?.id || "");
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Mark dirty on any change
  const markDirty = useCallback(() => setHasUnsaved(true), []);

  const upd = useCallback(<T extends object>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (partial: Partial<T>) => { setter((prev) => ({ ...prev, ...partial })); markDirty(); },
    [markDirty]
  );

  const handleSave = useCallback(() => {
    fetcher.submit(
      {
        intent: "save",
        branding: JSON.stringify(branding),
        overview: JSON.stringify(overview),
        address: JSON.stringify(address),
        lineItems: JSON.stringify(lineItems),
        notes: JSON.stringify(notes),
        totals: JSON.stringify(totals),
        footer: JSON.stringify(footer),
        labels: JSON.stringify(labels),
      },
      { method: "POST" }
    );
    setHasUnsaved(false);
  }, [fetcher, branding, overview, address, lineItems, notes, totals, footer, labels]);

  useEffect(() => {
    if (fetcher.data?.success) {
      setHasUnsaved(false);
      setPreviewKey((k) => k + 1);
    }
  }, [fetcher.data]);

  const isSaving = fetcher.state !== "idle";

  // Build preview URL — use live generation endpoint so preview always works
  const [previewKey, setPreviewKey] = useState(0);
  const previewPdfUrl = previewInvoiceId
    ? `/invoice/pdf/${previewInvoiceId}?t=${previewKey}`
    : null;

  const tabs = [
    { id: "branding", content: "Branding & Style" },
    { id: "overview", content: "Overview" },
    { id: "address", content: "Address" },
    { id: "lineItems", content: "Line Items" },
    { id: "notes", content: "Notes" },
    { id: "totals", content: "Order Totals" },
    { id: "footer", content: "Footer" },
    { id: "labels", content: "Translate Labels" },
  ];

  return (
    <Page
      title={`Edit ${templateName}`}
      subtitle="Customize invoice appearance"
      backAction={{ content: "Templates", url: "/app/templates" }}
      primaryAction={editorMode === "code"
        ? { content: isSaving ? "Saving…" : "Save Template", onAction: handleSaveTemplate, loading: isSaving }
        : { content: isSaving ? "Saving…" : "Save", onAction: handleSave, loading: isSaving, disabled: !hasUnsaved && !isSaving }
      }
      secondaryActions={editorMode === "customize"
        ? [{ content: "Discard", onAction: () => navigate("/app/templates"), disabled: !hasUnsaved }]
        : []
      }
    >
      <TitleBar title={`Edit ${templateName}`} />

      {/* ── Mode Toggle ── */}
      <div style={{ marginBottom: 16 }}>
        <InlineStack gap="200" blockAlign="center">
          <Button
            variant={editorMode === "customize" ? "primary" : "plain"}
            onClick={() => setEditorMode("customize")}
            size="slim"
          >
            Customize
          </Button>
          <Button
            variant={editorMode === "code" ? "primary" : "plain"}
            onClick={() => setEditorMode("code")}
            size="slim"
          >
            Code Editor
          </Button>
          {editorMode === "code" && (
            <Text as="span" variant="bodySm" tone="subdued">
              Edit HTML + Liquid template directly
            </Text>
          )}
        </InlineStack>
      </div>

      {fetcher.data?.success && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="success">{fetcher.data.message}</Banner>
        </div>
      )}

      {/* ── Code Editor Mode ── */}
      {editorMode === "code" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          {/* Left: Editor */}
          <Card padding="0">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #e1e3e5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#008060" }} />
                  <Text as="span" variant="bodySm" fontWeight="semibold">Liquid + HTML</Text>
                </InlineStack>
                <Button size="slim" onClick={handlePreview} loading={previewFetcher.state !== "idle"}>
                  Preview
                </Button>
              </div>
              <div style={{ overflow: "auto" }}>
                <Suspense fallback={<div style={{ padding: 20 }}>Loading editor…</div>}>
                  <CodeMirrorBundle value={templateCode} onChange={setTemplateCode} />
                </Suspense>
              </div>
              <div style={{ padding: "8px 14px", borderTop: "1px solid #e1e3e5" }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  Variables: <code>{"{{ shop.name }}"}</code>, <code>{"{{ invoice.number }}"}</code>,{" "}
                  <code>{"{{ buyer.name }}"}</code>, <code>{"{% for item in lineItems %}"}</code>,{" "}
                  <code>{"{{ totals.grandTotal | money }}"}</code>
                </Text>
              </div>
            </div>
          </Card>

          {/* Right: HTML Preview */}
          <Card padding="0">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #e1e3e5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Text as="span" variant="bodySm" fontWeight="semibold">Preview</Text>
                {previewFetcher.data?.html && (
                  <Text as="span" variant="bodySm" tone="subdued">Scroll to see full invoice</Text>
                )}
              </div>
              <div style={{ overflow: "auto", maxHeight: "calc(100vh - 180px)", background: "#f4f6f8" }}>
                {previewFetcher.state !== "idle" ? (
                  <div style={{ padding: 40, textAlign: "center" }}>
                    <Text as="p" variant="bodySm" tone="subdued">Rendering…</Text>
                  </div>
                ) : previewFetcher.data?.html ? (
                  <iframe
                    srcDoc={previewFetcher.data.html}
                    style={{ width: "100%", minWidth: 700, height: 1050, border: "none", display: "block" }}
                    title="Template Preview"
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: "center" }}>
                    <Text as="p" variant="bodySm" tone="subdued">Click Preview to render your template</Text>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Customize Mode ── */}
      {editorMode === "customize" && hasUnsaved && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning">You have unsaved changes.</Banner>
        </div>
      )}

      {editorMode === "customize" && <Layout>
        {/* ── Left Panel: Settings ── */}
        <Layout.Section variant="oneThird">
          <Card padding="0">
            <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab}>
              <Box padding="400">
                {/* ── Branding & Style ── */}
                {activeTab === 0 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Typography" subtitle="Font settings for PDF" />
                    <Select
                      label="Font Family"
                      options={[
                        { label: "Noto Sans — supports ₹ symbol (Recommended)", value: "NotoSans" },
                        { label: "Helvetica", value: "Helvetica" },
                        { label: "Times New Roman", value: "Times-Roman" },
                        { label: "Courier", value: "Courier" },
                      ]}
                      value={branding.fontFamily}
                      onChange={(v) => upd(setBranding)({ fontFamily: v })}
                      helpText="Noto Sans recommended — only font that correctly renders the ₹ (Rupee) symbol in PDFs."
                    />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">Heading Font Size</Text>
                      <RangeSlider
                        label={`${branding.headingSize} px`}
                        value={branding.headingSize}
                        min={9} max={18}
                        onChange={(v) => upd(setBranding)({ headingSize: v as number })}
                        output
                      />
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">Body Font Size</Text>
                      <RangeSlider
                        label={`${branding.bodySize} px`}
                        value={branding.bodySize}
                        min={7} max={14}
                        onChange={(v) => upd(setBranding)({ bodySize: v as number })}
                        output
                      />
                    </BlockStack>
                  </BlockStack>
                )}

                {/* ── Overview ── */}
                {activeTab === 1 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Logo" />
                    <ToggleRow label="Show Logo" checked={overview.showLogo} onChange={(v) => upd(setOverview)({ showLogo: v })} />
                    {overview.showLogo && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm">Logo Width (px)</Text>
                        <RangeSlider label={`${overview.logoWidth}px`} value={overview.logoWidth} min={20} max={200}
                          onChange={(v) => upd(setOverview)({ logoWidth: v as number })} output />
                      </BlockStack>
                    )}
                    <Divider />
                    <SectionHeader title="Invoice Header" />
                    <ToggleRow label="Show Invoice Title" checked={overview.showTitle} onChange={(v) => upd(setOverview)({ showTitle: v })} />
                    {overview.showTitle && (
                      <TextField label="Invoice Title Label" value={overview.invoiceTitleLabel}
                        onChange={(v) => upd(setOverview)({ invoiceTitleLabel: v })} autoComplete="off" />
                    )}
                    <ToggleRow label="Show Supplier GSTIN" checked={overview.showSupplierGstin} onChange={(v) => upd(setOverview)({ showSupplierGstin: v })} />
                    <ToggleRow label="Show QR Code (E-Invoice)" checked={overview.showQrCode} onChange={(v) => upd(setOverview)({ showQrCode: v })} />
                    <ToggleRow label="Show Paid Watermark" checked={overview.showPaidWatermark}
                      onChange={(v) => upd(setOverview)({ showPaidWatermark: v })}
                      helpText="Shows a 'PAID' watermark when order is fully paid" />
                    <Divider />
                    <SectionHeader title="Invoice Details" />
                    <ToggleRow label="Show Invoice Number" checked={overview.showInvoiceNumber} onChange={(v) => upd(setOverview)({ showInvoiceNumber: v })} />
                    {overview.showInvoiceNumber && (
                      <TextField label="Invoice Number Label" value={overview.invoiceNumberLabel}
                        onChange={(v) => upd(setOverview)({ invoiceNumberLabel: v })} autoComplete="off" />
                    )}
                    <ToggleRow label="Show Order Date" checked={overview.showOrderDate} onChange={(v) => upd(setOverview)({ showOrderDate: v })} />
                    {overview.showOrderDate && (
                      <TextField label="Order Date Label" value={overview.orderDateLabel}
                        onChange={(v) => upd(setOverview)({ orderDateLabel: v })} autoComplete="off" />
                    )}
                    <ToggleRow label="Show Place of Supply" checked={overview.showPlaceOfSupply} onChange={(v) => upd(setOverview)({ showPlaceOfSupply: v })} />
                    <ToggleRow label="Show Payment Gateway" checked={overview.showPaymentGateway} onChange={(v) => upd(setOverview)({ showPaymentGateway: v })} />
                    <ToggleRow label="Show Order Number" checked={overview.showOrderNumber} onChange={(v) => upd(setOverview)({ showOrderNumber: v })} />
                    <ToggleRow label="Show Due Date" checked={overview.showDueDate} onChange={(v) => upd(setOverview)({ showDueDate: v })} />
                    <ToggleRow label="Show Tracking Info" checked={overview.showTrackingInfo} onChange={(v) => upd(setOverview)({ showTrackingInfo: v })} />
                    <ToggleRow label="Show Order Tags" checked={overview.showOrderTags} onChange={(v) => upd(setOverview)({ showOrderTags: v })} />
                  </BlockStack>
                )}

                {/* ── Address ── */}
                {activeTab === 2 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Supplier Details" />
                    <ToggleRow label="Show Supplier Section" checked={address.supplier.show}
                      onChange={(v) => upd(setAddress)({ supplier: { ...address.supplier, show: v } })} />
                    {address.supplier.show && (
                      <BlockStack gap="150">
                        {(["showName", "showAddress", "showCountry", "showPhone", "showGstin", "showEmail"] as const).map((field) => (
                          <Checkbox key={field} label={field.replace("show", "Show ")}
                            checked={address.supplier[field] as boolean}
                            onChange={(v) => upd(setAddress)({ supplier: { ...address.supplier, [field]: v } })} />
                        ))}
                      </BlockStack>
                    )}
                    <Divider />
                    <SectionHeader title="Billing Details" />
                    <ToggleRow label="Show Billing Section" checked={address.billing.show}
                      onChange={(v) => upd(setAddress)({ billing: { ...address.billing, show: v } })} />
                    {address.billing.show && (
                      <BlockStack gap="150">
                        {(["showName", "showAddress", "showCompany", "showStateCode", "showPhone", "showEmail", "showGstin"] as const).map((field) => (
                          <Checkbox key={field} label={field.replace("show", "Show ")}
                            checked={address.billing[field] as boolean}
                            onChange={(v) => upd(setAddress)({ billing: { ...address.billing, [field]: v } })} />
                        ))}
                      </BlockStack>
                    )}
                    <Divider />
                    <SectionHeader title="Shipping Details" />
                    <ToggleRow label="Show Shipping Section" checked={address.shipping.show}
                      onChange={(v) => upd(setAddress)({ shipping: { ...address.shipping, show: v } })} />
                    {address.shipping.show && (
                      <BlockStack gap="150">
                        {(["showName", "showAddress", "showCompany", "showStateCode", "showPhone", "showEmail"] as const).map((field) => (
                          <Checkbox key={field} label={field.replace("show", "Show ")}
                            checked={address.shipping[field] as boolean}
                            onChange={(v) => upd(setAddress)({ shipping: { ...address.shipping, [field]: v } })} />
                        ))}
                      </BlockStack>
                    )}
                    <Divider />
                    <ToggleRow label="Fallback to available addresses"
                      checked={address.fallback} onChange={(v) => upd(setAddress)({ fallback: v })}
                      helpText="Use customer default address if shipping/billing is missing (POS orders)" />
                  </BlockStack>
                )}

                {/* ── Line Items ── */}
                {activeTab === 3 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Column Visibility" />
                    <BlockStack gap="150">
                      {Object.entries(lineItems.columnVisibility).map(([col, visible]) => (
                        <Checkbox key={col} label={col.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                          checked={visible}
                          onChange={(v) => upd(setLineItems)({ columnVisibility: { ...lineItems.columnVisibility, [col]: v } })} />
                      ))}
                    </BlockStack>
                    <Divider />
                    <SectionHeader title="Display Options" />
                    <BlockStack gap="150">
                      <ToggleRow label="Show Product Image" checked={lineItems.showProductImage} onChange={(v) => upd(setLineItems)({ showProductImage: v })} />
                      <ToggleRow label="Show Product SKU" checked={lineItems.showSku} onChange={(v) => upd(setLineItems)({ showSku: v })} />
                      <ToggleRow label="Show Barcode" checked={lineItems.showBarcode} onChange={(v) => upd(setLineItems)({ showBarcode: v })} />
                      {lineItems.showBarcode && (
                        <>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm">Barcode Width</Text>
                            <RangeSlider label={`${lineItems.barcodeWidth}px`} value={lineItems.barcodeWidth} min={40} max={200}
                              onChange={(v) => upd(setLineItems)({ barcodeWidth: v as number })} output />
                          </BlockStack>
                          <ToggleRow label="Show Barcode Value" checked={lineItems.showBarcodeValue} onChange={(v) => upd(setLineItems)({ showBarcodeValue: v })} />
                        </>
                      )}
                      <ToggleRow label="Show Product Weight" checked={lineItems.showWeight} onChange={(v) => upd(setLineItems)({ showWeight: v })} />
                      <ToggleRow label="Show Vendor" checked={lineItems.showVendor} onChange={(v) => upd(setLineItems)({ showVendor: v })} />
                      <ToggleRow label="Show Fulfillment Location" checked={lineItems.showFulfillmentLocation} onChange={(v) => upd(setLineItems)({ showFulfillmentLocation: v })} />
                      <ToggleRow label="Show Compare-at Price" checked={lineItems.showCompareAtPrice} onChange={(v) => upd(setLineItems)({ showCompareAtPrice: v })} />
                      <ToggleRow label="Show Refund Quantity" checked={lineItems.showRefundQty} onChange={(v) => upd(setLineItems)({ showRefundQty: v })} />
                      <ToggleRow label="Show Total Summary Row" checked={lineItems.showSummaryRow} onChange={(v) => upd(setLineItems)({ showSummaryRow: v })} />
                    </BlockStack>
                    <Divider />
                    <SectionHeader title="Tax Split Labels" />
                    <TextField label="IGST Label" value={lineItems.igstLabel} onChange={(v) => upd(setLineItems)({ igstLabel: v })} autoComplete="off" />
                    <TextField label="CGST Label" value={lineItems.cgstLabel} onChange={(v) => upd(setLineItems)({ cgstLabel: v })} autoComplete="off" />
                    <TextField label="SGST Label" value={lineItems.sgstLabel} onChange={(v) => upd(setLineItems)({ sgstLabel: v })} autoComplete="off" />
                  </BlockStack>
                )}

                {/* ── Notes ── */}
                {activeTab === 4 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Notes" />
                    <ToggleRow label="Show Order Notes" checked={notes.showOrderNotes} onChange={(v) => upd(setNotes)({ showOrderNotes: v })} />
                    {notes.showOrderNotes && (
                      <>
                        <TextField label="Order Note Title" value={notes.orderNoteTitle}
                          onChange={(v) => upd(setNotes)({ orderNoteTitle: v })} autoComplete="off" />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Order notes come from the customer&apos;s note entered during checkout (visible in Shopify order details). This section only appears on invoices where the order has a customer note.
                        </Text>
                      </>
                    )}
                    <Divider />
                    <SectionHeader title="Thank You Note" />
                    <ToggleRow label="Show Thank You Note" checked={notes.showThankYou} onChange={(v) => upd(setNotes)({ showThankYou: v })} />
                    {notes.showThankYou && (
                      <TextField label="Thank You Note" value={notes.thankYouNote} multiline={3}
                        onChange={(v) => upd(setNotes)({ thankYouNote: v })} autoComplete="off" />
                    )}
                    <Divider />
                    <SectionHeader title="Contact Email" />
                    <ToggleRow label="Show Contact Email" checked={notes.showContactEmail} onChange={(v) => upd(setNotes)({ showContactEmail: v })} />
                    {notes.showContactEmail && (
                      <>
                        <TextField label="Email Prefix Text" value={notes.emailPrefixText}
                          onChange={(v) => upd(setNotes)({ emailPrefixText: v })} autoComplete="off" />
                        <TextField label="Your Email Address" value={notes.contactEmail}
                          onChange={(v) => upd(setNotes)({ contactEmail: v })} type="email" autoComplete="off" />
                      </>
                    )}
                  </BlockStack>
                )}

                {/* ── Order Totals ── */}
                {activeTab === 5 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Totals Visibility" subtitle="Show or hide each row" />
                    <BlockStack gap="150">
                      {Object.entries(totals.rowVisibility).map(([row, visible]) => (
                        <Checkbox key={row} label={row.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                          checked={visible}
                          onChange={(v) => upd(setTotals)({ rowVisibility: { ...totals.rowVisibility, [row]: v } })} />
                      ))}
                    </BlockStack>
                    <Divider />
                    <ToggleRow label="Show Total in Words" checked={totals.showTotalInWords}
                      onChange={(v) => upd(setTotals)({ showTotalInWords: v })} />
                    <Divider />
                    <SectionHeader title="Signature" />
                    <ToggleRow label="Show Signature" checked={totals.showSignature}
                      onChange={(v) => upd(setTotals)({ showSignature: v })}
                      helpText={shopSignatureUrl ? "Configured in settings" : "Upload in Settings → Logo & Signature"} />
                    {totals.showSignature && !shopSignatureUrl && (
                      <Banner tone="warning">
                        No signature uploaded. <Button variant="plain" url="/app/settings">Upload in Settings</Button>
                      </Banner>
                    )}
                  </BlockStack>
                )}

                {/* ── Footer ── */}
                {activeTab === 6 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Social Media" />
                    <ToggleRow label="Hide social links on print" checked={footer.hideSocialOnPrint}
                      onChange={(v) => upd(setFooter)({ hideSocialOnPrint: v })} />
                    {[
                      { key: "Website", show: "showWebsite", label: "websiteLabel", url: "websiteUrl" },
                      { key: "Facebook", show: "showFacebook", label: "facebookLabel", url: "facebookUrl" },
                      { key: "Instagram", show: "showInstagram", label: "instagramLabel", url: "instagramUrl" },
                      { key: "X", show: "showX", label: "xLabel", url: "xUrl" },
                    ].map(({ key, show, label, url }) => (
                      <BlockStack key={key} gap="150">
                        <ToggleRow label={`Show ${key}`}
                          checked={footer[show as keyof FooterSettings] as boolean}
                          onChange={(v) => upd(setFooter)({ [show]: v })} />
                        {footer[show as keyof FooterSettings] && (
                          <InlineStack gap="200">
                            <div style={{ flex: 1 }}>
                              <TextField label={`${key} Name`} value={footer[label as keyof FooterSettings] as string}
                                onChange={(v) => upd(setFooter)({ [label]: v })} autoComplete="off" />
                            </div>
                            <div style={{ flex: 2 }}>
                              <TextField label={`${key} Link`} value={footer[url as keyof FooterSettings] as string}
                                onChange={(v) => upd(setFooter)({ [url]: v })} autoComplete="off" />
                            </div>
                          </InlineStack>
                        )}
                      </BlockStack>
                    ))}
                    <Divider />
                    <SectionHeader title="Footer Notes" />
                    <ToggleRow label="Show Footer Notes" checked={footer.showFooterNotes}
                      onChange={(v) => upd(setFooter)({ showFooterNotes: v })} />
                    {footer.showFooterNotes && (
                      <TextField label="Footer Note" value={footer.footerNotes} multiline={3}
                        onChange={(v) => upd(setFooter)({ footerNotes: v })} autoComplete="off" />
                    )}
                    <Divider />
                    <ToggleRow label="Show Disclaimer Note" checked={footer.showDisclaimer}
                      onChange={(v) => upd(setFooter)({ showDisclaimer: v })} />
                  </BlockStack>
                )}

                {/* ── Translate Labels ── */}
                {activeTab === 7 && (
                  <BlockStack gap="400">
                    <SectionHeader title="Translate Labels & Content"
                      subtitle="Rename any field shown on the invoice" />
                    {(Object.entries(labels) as [keyof LabelsSettings, string][]).map(([key, val]) => (
                      <TextField key={key}
                        label={key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                        value={val}
                        onChange={(v) => upd(setLabels)({ [key]: v } as Partial<LabelsSettings>)}
                        autoComplete="off"
                      />
                    ))}
                  </BlockStack>
                )}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>

        {/* ── Right Panel: Preview ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">Preview</Text>
                  <Badge>{templateName}</Badge>
                </InlineStack>
                <div style={{ minWidth: 200 }}>
                  <Select
                    label=""
                    labelHidden
                    options={[
                      { label: "Select an order to preview…", value: "" },
                      ...recentInvoices.map((inv) => ({
                        label: `${inv.orderName || inv.invoiceNumber}`,
                        value: inv.id,
                      })),
                    ]}
                    value={previewInvoiceId}
                    onChange={setPreviewInvoiceId}
                  />
                </div>
              </InlineStack>

              {previewPdfUrl ? (
                <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden" }}>
                  <iframe
                    key={previewPdfUrl}
                    src={previewPdfUrl}
                    style={{ width: "100%", height: 800, border: "none", display: "block" }}
                    title="Invoice Preview"
                  />
                </div>
              ) : (
                <div style={{
                  border: "2px dashed #c9cccf", borderRadius: 8,
                  padding: "80px 24px", textAlign: "center", background: "#fafafa",
                }}>
                  <BlockStack gap="300" align="center">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {recentInvoices.length === 0
                        ? "No invoices found. Create an order in Shopify first."
                        : "Select an order above to preview the invoice."}
                    </Text>
                    {recentInvoices.length === 0 && (
                      <Button url="/app/orders" variant="primary">Go to Orders</Button>
                    )}
                  </BlockStack>
                </div>
              )}

              <Text as="p" variant="bodySm" tone="subdued">
                Preview reflects saved settings. Save your changes to update the preview.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>}

    </Page>
  );
}
