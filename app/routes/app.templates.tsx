import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, BlockStack, Text, InlineStack, Badge, Button, Box, Tabs, Banner, Modal, Spinner, Card,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { TEMPLATES_META } from "~/components/invoice-templates";
import { openUpgradePopup } from "~/components/PlanLimitModal";

// ── Packing slip variants metadata ───────────────────────────────────────────

const PACKING_SLIP_META = [
  { id: "default", name: "Classic", description: "Clean white design with a dark item table.", primaryColor: "#1a73e8", bgColor: "#E8F0FE" },
  { id: "bold", name: "Bold", description: "Dark charcoal header with strong white typography.", primaryColor: "#1C1C1E", bgColor: "#F5F5F5" },
  { id: "oasis", name: "Oasis", description: "Warm terracotta tones — friendly and inviting.", primaryColor: "#BF360C", bgColor: "#FBE9E7" },
  { id: "orbix", name: "Orbix", description: "Dark navy ultra-minimal — precise and tech-forward.", primaryColor: "#0D2035", bgColor: "#ECEFF1" },
];

// Free stores get the first design of each kind; the rest are Pro
const FREE_INVOICE_TEMPLATE = "template-1";
const FREE_SLIP_TEMPLATE = "default";

// ── Loaders / Actions ─────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });
  return json({
    templateId: shop?.settings?.templateId || FREE_INVOICE_TEMPLATE,
    packingSlipTemplateId: shop?.settings?.packingSlipTemplateId || FREE_SLIP_TEMPLATE,
    canUseAll: canUseFeature(shop?.currentPlan || "free", "all-templates"),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });
  const canUseAll = canUseFeature(shop.currentPlan, "all-templates");

  // Real PDF of any template with the store's latest invoice (or a sample) — nothing is saved
  if (intent === "preview") {
    const kind = formData.get("kind") === "packing-slip" ? "packing-slip" : "invoice";
    const templateId = formData.get("templateId") as string;
    const valid = kind === "invoice"
      ? TEMPLATES_META.some((t) => t.id === templateId)
      : PACKING_SLIP_META.some((t) => t.id === templateId);
    if (!valid) return json({ error: "Invalid template" }, { status: 400 });
    const { generateTemplatePreviewPDF } = await import("~/lib/pdf.server");
    const { buffer, sample } = await generateTemplatePreviewPDF(shop.id, kind, templateId);
    return json({ previewPdf: buffer.toString("base64"), sample });
  }

  if (intent === "save-invoice-template") {
    const templateId = formData.get("templateId") as string;
    if (!TEMPLATES_META.find((t) => t.id === templateId)) {
      return json({ error: "Invalid template" }, { status: 400 });
    }
    if (templateId !== FREE_INVOICE_TEMPLATE && !canUseAll) {
      return json({ error: "This template is available on the Pro plan." }, { status: 403 });
    }
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      update: { templateId },
      create: { shopId: shop.id, templateId },
    });
    return json({ success: true, templateId });
  }

  if (intent === "save-packing-slip-template") {
    const packingSlipTemplateId = formData.get("packingSlipTemplateId") as string;
    if (!PACKING_SLIP_META.find((t) => t.id === packingSlipTemplateId)) {
      return json({ error: "Invalid packing slip template" }, { status: 400 });
    }
    // Billing promises "all packing slip templates" on Pro — this wasn't enforced before
    if (packingSlipTemplateId !== FREE_SLIP_TEMPLATE && !canUseAll) {
      return json({ error: "This packing slip design is available on the Pro plan." }, { status: 403 });
    }
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      update: { packingSlipTemplateId },
      create: { shopId: shop.id, packingSlipTemplateId },
    });
    return json({ success: true, packingSlipTemplateId });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Thumbnails ────────────────────────────────────────────────────────────────

type Meta = { id: string; name: string; description: string; primaryColor: string; bgColor: string; accentColor?: string };

function Thumbnail({ meta, kind }: { meta: Meta; kind: "invoice" | "packing-slip" }) {
  const { primaryColor, bgColor } = meta;
  const accent = meta.accentColor || primaryColor;
  const cols = kind === "invoice" ? [12, 28, 10, 10, 10, 12] : [8, 50, 14];
  return (
    <div style={{ width: "100%", height: 120, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden", position: "relative" }}>
      <div style={{ background: primaryColor, padding: "8px 10px", display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ background: "rgba(255,255,255,0.3)", width: 40, height: 6, borderRadius: 2, marginBottom: 4 }} />
          <div style={{ background: "rgba(255,255,255,0.2)", width: 60, height: 4, borderRadius: 2 }} />
        </div>
        <div>
          <div style={{ background: "rgba(255,255,255,0.4)", width: 32, height: 9, borderRadius: 1, marginBottom: 4 }} />
          <div style={{ background: accent !== primaryColor ? accent : "rgba(255,255,255,0.35)", width: 36, height: 4, borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ padding: "6px 10px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, background: bgColor, padding: 5, borderRadius: 3 }}>
              <div style={{ width: 20, height: 3, background: primaryColor, marginBottom: 4, borderRadius: 1 }} />
              <div style={{ width: "70%", height: 3, background: "#ccc", borderRadius: 1 }} />
            </div>
          ))}
        </div>
        <div style={{ background: primaryColor, height: 8, borderRadius: 2, display: "flex", alignItems: "center", padding: "0 5px", gap: 4, marginBottom: 2 }}>
          {cols.map((w, i) => <div key={i} style={{ width: `${w}%`, height: 3, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />)}
        </div>
        {[false, true].map((alt, ri) => (
          <div key={ri} style={{ display: "flex", padding: "1.5px 5px", gap: 4, background: alt ? bgColor : "transparent", marginBottom: 1 }}>
            {cols.map((w, i) => <div key={i} style={{ width: `${w}%`, height: 3, background: "#e0e0e0", borderRadius: 1 }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

type ActionData = {
  success?: boolean; templateId?: string; packingSlipTemplateId?: string; error?: string;
  previewPdf?: string; sample?: boolean;
};

const proPopup = (what: string) =>
  openUpgradePopup({
    title: `${what} is a Pro design`,
    lines: [
      "Use Preview to see exactly how your invoices would look in it.",
      "Upgrade to Pro to unlock all invoice and packing slip designs.",
    ],
  });

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { templateId: savedTemplateId, packingSlipTemplateId: savedSlipTemplateId, canUseAll } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionData>();
  const previewFetcher = useFetcher<ActionData>();
  const [selectedTab, setSelectedTab] = useState(0);
  const kind = selectedTab === 0 ? "invoice" : "packing-slip";

  const activeTemplateId = saveFetcher.data?.templateId ?? savedTemplateId;
  const activeSlipTemplateId = saveFetcher.data?.packingSlipTemplateId ?? savedSlipTemplateId;
  const savingId = saveFetcher.state !== "idle"
    ? (saveFetcher.formData?.get("templateId") || saveFetcher.formData?.get("packingSlipTemplateId"))
    : null;

  // Preview modal: the real PDF, shown inline
  const [preview, setPreview] = useState<{ meta: Meta; kind: "invoice" | "packing-slip" } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const b64 = previewFetcher.data?.previewPdf;
    if (!b64 || !preview) return;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetcher.data]);

  const openPreview = (meta: Meta, k: "invoice" | "packing-slip") => {
    setPreviewUrl(null);
    setPreview({ meta, kind: k });
    previewFetcher.submit({ intent: "preview", kind: k, templateId: meta.id }, { method: "POST" });
  };

  const isLocked = (meta: Meta, k: "invoice" | "packing-slip") =>
    !canUseAll && meta.id !== (k === "invoice" ? FREE_INVOICE_TEMPLATE : FREE_SLIP_TEMPLATE);

  const applyTemplate = useCallback((meta: Meta, k: "invoice" | "packing-slip") => {
    if (isLocked(meta, k)) return proPopup(meta.name);
    saveFetcher.submit(
      k === "invoice"
        ? { intent: "save-invoice-template", templateId: meta.id }
        : { intent: "save-packing-slip-template", packingSlipTemplateId: meta.id },
      { method: "POST" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher, canUseAll]);

  const list: Meta[] = kind === "invoice" ? TEMPLATES_META : PACKING_SLIP_META;
  const activeId = kind === "invoice" ? activeTemplateId : activeSlipTemplateId;
  const activeName = list.find((m) => m.id === activeId)?.name ?? list[0].name;

  return (
    <Page title="Invoice Templates" fullWidth>
      <TitleBar title="Invoice Templates" />
      <BlockStack gap="400">

        {saveFetcher.data?.error && <Banner tone="critical">{saveFetcher.data.error}</Banner>}

        <Card padding="0">
          <Tabs
            tabs={[{ id: "invoice", content: "Invoice" }, { id: "packing-slip", content: "Packing Slip" }]}
            selected={selectedTab}
            onSelect={setSelectedTab}
          >
            <Box padding="400">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {kind === "invoice"
                      ? "Pick the design for your GST invoices. Every invoice you download, print or email from now on uses it — including older invoices."
                      : "Pick the design for packing slips. It's separate from your invoice design, so you can mix and match."}
                  </Text>
                  <Text as="p" variant="bodySm">In use: <strong>{activeName}</strong></Text>
                </InlineStack>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                  {list.map((meta) => {
                    const isActive = activeId === meta.id;
                    const locked = isLocked(meta, kind);
                    return (
                      <div
                        key={meta.id}
                        style={{
                          border: isActive ? `2px solid ${meta.primaryColor}` : "1px solid #e0e0e0",
                          borderRadius: 8, overflow: "hidden", background: "#fff",
                          boxShadow: isActive ? `0 0 0 3px ${meta.bgColor}` : "none",
                        }}
                      >
                        <div style={{ padding: "10px 10px 0", cursor: "pointer" }} onClick={() => openPreview(meta, kind)} role="presentation">
                          <Thumbnail meta={meta} kind={kind} />
                        </div>
                        <Box padding="300">
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: meta.primaryColor }} />
                              <Text as="h3" variant="headingXs">{meta.name}</Text>
                              {isActive && <Badge tone="success">In use</Badge>}
                              {locked && <Badge tone="warning">Pro</Badge>}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">{meta.description}</Text>
                            <InlineStack gap="200">
                              <Button size="slim" onClick={() => openPreview(meta, kind)}>Preview</Button>
                              {kind === "invoice" && (
                                <Button size="slim" variant="plain" onClick={() => (locked ? proPopup(meta.name) : navigate(`/app/customize/${meta.id}`))}>
                                  Personalize
                                </Button>
                              )}
                              {!isActive && (
                                <Button size="slim" variant="primary" loading={savingId === meta.id} onClick={() => applyTemplate(meta, kind)}>
                                  Use this design
                                </Button>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      </div>
                    );
                  })}
                </div>

                <Text as="p" variant="bodySm" tone="subdued">
                  Estimates use a Quotation design and refunds use a Credit Note design. Both pick up your logo, signature and
                  business details automatically.
                </Text>
              </BlockStack>
            </Box>
          </Tabs>
        </Card>
      </BlockStack>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? `${preview.meta.name} — preview` : ""}
        size="large"
        primaryAction={
          preview && (preview.kind === "invoice" ? activeTemplateId : activeSlipTemplateId) !== preview.meta.id
            ? { content: "Use this design", onAction: () => { applyTemplate(preview.meta, preview.kind); setPreview(null); } }
            : undefined
        }
        secondaryActions={[{ content: "Close", onAction: () => setPreview(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            {previewFetcher.data?.sample && previewUrl && (
              <Text as="p" variant="bodySm" tone="subdued">Showing sample data with your business details — your real invoices will appear here once you have orders.</Text>
            )}
            {previewFetcher.data?.error && <Banner tone="critical">{previewFetcher.data.error}</Banner>}
            {previewUrl ? (
              <iframe src={previewUrl} title="Template preview" style={{ width: "100%", height: "70vh", border: "1px solid #e0e0e0", borderRadius: 6 }} />
            ) : (
              <Box padding="800"><InlineStack align="center"><Spinner size="large" /></InlineStack></Box>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
