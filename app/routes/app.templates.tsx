import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, InlineStack, Badge, Button, Box,
  Tabs, Divider, Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { TEMPLATES_META } from "~/components/invoice-templates";

// ── Packing slip variants metadata ───────────────────────────────────────────

const PACKING_SLIP_META = [
  {
    id: "default",
    name: "Classic",
    description: "Clean white design with blue accents and alternating rows.",
    primaryColor: "#1a73e8",
    bgColor: "#E8F0FE",
  },
  {
    id: "bold",
    name: "Bold",
    description: "Dark charcoal header with strong white typography.",
    primaryColor: "#1C1C1E",
    bgColor: "#F5F5F5",
  },
  {
    id: "oasis",
    name: "Oasis",
    description: "Warm terracotta tones — friendly and inviting.",
    primaryColor: "#BF360C",
    bgColor: "#FBE9E7",
  },
  {
    id: "orbix",
    name: "Orbix",
    description: "Dark navy ultra-minimal — precise and tech-forward.",
    primaryColor: "#0D2035",
    bgColor: "#ECEFF1",
  },
];

// ── Loaders / Actions ─────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });
  return json({
    templateId: shop?.settings?.templateId || "template-1",
    packingSlipTemplateId: shop?.settings?.packingSlipTemplateId || "default",
    currentPlan: shop?.currentPlan || "free",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  if (intent === "save-invoice-template") {
    const templateId = formData.get("templateId") as string;
    if (!TEMPLATES_META.find((t) => t.id === templateId)) {
      return json({ error: "Invalid template" }, { status: 400 });
    }
    if (templateId !== "template-1" && !canUseFeature(shop.currentPlan, "all-templates")) {
      return json({ error: "Templates 2–6 require the Pro plan. Please upgrade." }, { status: 403 });
    }
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      update: { templateId },
      create: { shopId: shop.id, templateId },
    });
    return json({ success: true, templateId, packingSlipTemplateId: null });
  }

  if (intent === "save-packing-slip-template") {
    const packingSlipTemplateId = formData.get("packingSlipTemplateId") as string;
    if (!PACKING_SLIP_META.find((t) => t.id === packingSlipTemplateId)) {
      return json({ error: "Invalid packing slip template" }, { status: 400 });
    }
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      update: { packingSlipTemplateId },
      create: { shopId: shop.id, packingSlipTemplateId },
    });
    return json({ success: true, packingSlipTemplateId, templateId: null });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Thumbnails ────────────────────────────────────────────────────────────────

function InvoiceThumbnail({ meta }: { meta: typeof TEMPLATES_META[0] }) {
  const { primaryColor, bgColor } = meta;
  const accent = (meta as any).accentColor || primaryColor;

  return (
    <div style={{ width: "100%", height: 140, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden", position: "relative", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: primaryColor, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ background: "rgba(255,255,255,0.3)", width: 40, height: 6, borderRadius: 2, marginBottom: 4 }} />
          <div style={{ background: "rgba(255,255,255,0.2)", width: 60, height: 4, borderRadius: 2, marginBottom: 2 }} />
          <div style={{ background: "rgba(255,255,255,0.15)", width: 48, height: 3, borderRadius: 2 }} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ background: "rgba(255,255,255,0.4)", width: 32, height: 9, borderRadius: 1, marginBottom: 4 }} />
          <div style={{ background: "rgba(255,255,255,0.2)", width: 48, height: 3, borderRadius: 1, marginBottom: 2 }} />
          <div style={{ background: accent !== primaryColor ? accent : "rgba(255,255,255,0.35)", width: 36, height: 5, borderRadius: 2, marginTop: 3 }} />
        </div>
      </div>
      <div style={{ padding: "6px 10px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, background: bgColor, padding: 5, borderRadius: meta.id === "template-3" ? 0 : 3, borderLeft: meta.id === "template-3" ? `2.5px solid ${primaryColor}` : "none" }}>
              <div style={{ width: 20, height: 3, background: primaryColor, marginBottom: 4, borderRadius: 1 }} />
              <div style={{ width: "70%", height: 3, background: "#ccc", borderRadius: 1, marginBottom: 2 }} />
              <div style={{ width: "50%", height: 2.5, background: "#ddd", borderRadius: 1 }} />
            </div>
          ))}
        </div>
        <div style={{ background: primaryColor, height: 8, borderRadius: meta.id === "template-3" ? 0 : 2, display: "flex", alignItems: "center", padding: "0 5px", gap: 4, marginBottom: 2 }}>
          {[12, 28, 10, 10, 10, 12].map((w, i) => (
            <div key={i} style={{ width: `${w}%`, height: 3, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
          ))}
        </div>
        {[false, meta.id !== "template-6", false].map((alt, ri) => (
          <div key={ri} style={{ display: "flex", padding: "1.5px 5px", gap: 4, background: alt ? bgColor : "transparent", marginBottom: 1 }}>
            {[12, 28, 10, 10, 10, 12].map((w, i) => (
              <div key={i} style={{ width: `${w}%`, height: 3, background: i === 5 ? "#bbb" : "#e0e0e0", borderRadius: 1 }} />
            ))}
          </div>
        ))}
      </div>
      {meta.id === "template-4" && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: primaryColor }} />
      )}
    </div>
  );
}

function PackingSlipThumbnail({ meta }: { meta: typeof PACKING_SLIP_META[0] }) {
  const { primaryColor, bgColor } = meta;
  const isBold = meta.id === "bold";
  const isOrbix = meta.id === "orbix";

  return (
    <div style={{ width: "100%", height: 140, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      {isBold ? (
        <div style={{ background: primaryColor, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.25)", width: 50, height: 7, borderRadius: 2 }} />
          <div style={{ background: "rgba(255,255,255,0.4)", width: 38, height: 10, borderRadius: 1 }} />
        </div>
      ) : (
        <div style={{ padding: "8px 10px", borderBottom: `2px solid ${primaryColor}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: isOrbix ? "#fff" : "#fff" }}>
          <div>
            <div style={{ background: primaryColor, width: 44, height: 5, borderRadius: 1, marginBottom: 3, opacity: 0.7 }} />
            <div style={{ background: "#ddd", width: 60, height: 3, borderRadius: 1 }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ background: primaryColor, width: 40, height: 8, borderRadius: 1, marginBottom: 3 }} />
            <div style={{ background: "#ddd", width: 50, height: 3, borderRadius: 1 }} />
          </div>
        </div>
      )}
      {/* Body */}
      <div style={{ padding: "6px 10px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, background: bgColor, padding: 5, borderRadius: isBold ? 2 : 3, borderTop: isOrbix ? `1.5px solid ${primaryColor}` : "none" }}>
              <div style={{ width: 20, height: 3, background: primaryColor, marginBottom: 3, borderRadius: 1, opacity: 0.7 }} />
              <div style={{ width: "70%", height: 2.5, background: "#ccc", borderRadius: 1, marginBottom: 2 }} />
              <div style={{ width: "50%", height: 2.5, background: "#ddd", borderRadius: 1 }} />
            </div>
          ))}
        </div>
        <div style={{ background: primaryColor, height: 8, borderRadius: 2, display: "flex", alignItems: "center", padding: "0 5px", gap: 4, marginBottom: 2 }}>
          {[8, 1, 14].map((w, i) => (
            <div key={i} style={{ width: i === 1 ? "1fr" : `${w}%`, flex: i === 1 ? 1 : undefined, height: 3, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
          ))}
        </div>
        {[false, true, false].map((alt, ri) => (
          <div key={ri} style={{ display: "flex", padding: "1.5px 5px", gap: 4, background: alt ? bgColor : "transparent", marginBottom: 1 }}>
            {[8, 1, 14].map((w, i) => (
              <div key={i} style={{ width: i === 1 ? "1fr" : `${w}%`, flex: i === 1 ? 1 : undefined, height: 3, background: "#e0e0e0", borderRadius: 1 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Generic single-template info card (for Draft Order & Credit Note) ─────────

function SingleTemplateCard({
  name,
  description,
  accentColor,
  bgColor,
}: {
  name: string;
  description: string;
  accentColor: string;
  bgColor: string;
}) {
  return (
    <div style={{ border: `2px solid ${accentColor}`, borderRadius: 8, overflow: "hidden", background: "#fff", boxShadow: `0 0 0 3px ${bgColor}` }}>
      {/* Mini preview */}
      <div style={{ padding: "12px 12px 0" }}>
        <div style={{ width: "100%", height: 120, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ background: accentColor, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ background: "rgba(255,255,255,0.25)", width: 50, height: 6, borderRadius: 2 }} />
            <div style={{ background: "rgba(255,255,255,0.4)", width: 40, height: 10, borderRadius: 1 }} />
          </div>
          <div style={{ padding: "6px 10px" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 5 }}>
              {[0, 1].map((i) => (
                <div key={i} style={{ flex: 1, background: bgColor, padding: 4, borderRadius: 3 }}>
                  <div style={{ width: 20, height: 3, background: accentColor, marginBottom: 3, borderRadius: 1, opacity: 0.7 }} />
                  <div style={{ width: "70%", height: 2.5, background: "#ddd", borderRadius: 1 }} />
                </div>
              ))}
            </div>
            <div style={{ background: accentColor, height: 7, borderRadius: 2, marginBottom: 2, opacity: 0.9 }} />
            {[false, true].map((alt, ri) => (
              <div key={ri} style={{ height: 6, background: alt ? bgColor : "transparent", marginBottom: 1, borderRadius: 1 }} />
            ))}
          </div>
        </div>
      </div>
      {/* Footer */}
      <div style={{ padding: "10px 14px 12px" }}>
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: accentColor }} />
              <Text as="h3" variant="headingSm">{name}</Text>
              <Badge tone="success">Active</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
          </BlockStack>
        </InlineStack>
      </div>
    </div>
  );
}

// ── Tabs definition ───────────────────────────────────────────────────────────

const DOC_TABS = [
  { id: "invoice", content: "Invoice" },
  { id: "packing-slip", content: "Packing Slip" },
  { id: "draft-order", content: "Draft Order" },
  { id: "refund", content: "Refund / Credit Note" },
];

// ── Page component ────────────────────────────────────────────────────────────

type ActionData = { success?: boolean; templateId?: string | null; packingSlipTemplateId?: string | null; error?: string };

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { templateId: savedTemplateId, packingSlipTemplateId: savedSlipTemplateId, currentPlan } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [selectedTab, setSelectedTab] = useState(0);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [pendingSlipTemplate, setPendingSlipTemplate] = useState<string | null>(null);

  const isSaving = fetcher.state !== "idle";

  const activeTemplateId =
    fetcher.data?.templateId !== null && fetcher.data?.templateId !== undefined
      ? fetcher.data.templateId
      : savedTemplateId;

  const activeSlipTemplateId =
    fetcher.data?.packingSlipTemplateId !== null && fetcher.data?.packingSlipTemplateId !== undefined
      ? fetcher.data.packingSlipTemplateId
      : savedSlipTemplateId;

  const activeInvoiceMeta = TEMPLATES_META.find((t) => t.id === activeTemplateId);
  const activeSlipMeta = PACKING_SLIP_META.find((t) => t.id === activeSlipTemplateId);

  const handleSelectInvoice = useCallback((id: string) => {
    setPendingTemplate(id);
    const fd = new FormData();
    fd.append("intent", "save-invoice-template");
    fd.append("templateId", id);
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const handleSelectSlip = useCallback((id: string) => {
    setPendingSlipTemplate(id);
    const fd = new FormData();
    fd.append("intent", "save-packing-slip-template");
    fd.append("packingSlipTemplateId", id);
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  return (
    <Page title="Invoice Templates">
      <TitleBar title="Invoice Templates" />
      <BlockStack gap="500">

        <Banner tone="info">
          Select a template for your invoices. The selected template will be applied to all new PDFs generated.
          Existing PDFs are not regenerated automatically.
        </Banner>

        {/* ── Active templates summary — top of page ── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Currently Active Templates</Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {/* Invoice */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: activeInvoiceMeta?.primaryColor || "#1a73e8", flexShrink: 0 }} />
                <BlockStack gap="0">
                  <Text as="p" variant="bodySm" tone="subdued">Invoice</Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">{activeInvoiceMeta?.name || "Classic"}</Text>
                </BlockStack>
              </div>
              {/* Packing Slip */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: activeSlipMeta?.primaryColor || "#1a73e8", flexShrink: 0 }} />
                <BlockStack gap="0">
                  <Text as="p" variant="bodySm" tone="subdued">Packing Slip</Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">{activeSlipMeta?.name || "Classic"}</Text>
                </BlockStack>
              </div>
              {/* Draft Order */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#E65100", flexShrink: 0 }} />
                <BlockStack gap="0">
                  <Text as="p" variant="bodySm" tone="subdued">Draft Order / Estimate</Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Quotation</Text>
                </BlockStack>
              </div>
              {/* Credit Note */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#C62828", flexShrink: 0 }} />
                <BlockStack gap="0">
                  <Text as="p" variant="bodySm" tone="subdued">Refund / Credit Note</Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Credit Note</Text>
                </BlockStack>
              </div>
            </div>
          </BlockStack>
        </Card>

        <Divider />

        <Tabs tabs={DOC_TABS} selected={selectedTab} onSelect={setSelectedTab}>
          <Box paddingBlockStart="400">

            {/* ── Invoice tab ── */}
            {selectedTab === 0 && (
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose an invoice template. Your selection is saved automatically.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  {TEMPLATES_META.map((meta) => {
                    const isActive = activeTemplateId === meta.id;
                    const isSavingThis = isSaving && pendingTemplate === meta.id;
                    const isLocked = meta.id !== "template-1" && !canUseFeature(currentPlan, "all-templates");
                    return (
                      <div key={meta.id} style={{ position: "relative", border: isActive ? `2px solid ${meta.primaryColor}` : "1.5px solid #e0e0e0", borderRadius: 8, overflow: "hidden", background: "#fff", boxShadow: isActive ? `0 0 0 3px ${meta.bgColor}` : "none", transition: "box-shadow 0.15s" }}>
                        <div style={{ padding: "12px 12px 0" }}>
                          <InvoiceThumbnail meta={meta} />
                        </div>
                        <div style={{ padding: "10px 14px 12px" }}>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: meta.primaryColor, flexShrink: 0 }} />
                                <Text as="h3" variant="headingSm">{meta.name}</Text>
                                {isActive && <Badge tone="success">Active</Badge>}
                                {isLocked && (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                                    🔒 Pro
                                  </span>
                                )}
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">{meta.description}</Text>
                            </BlockStack>
                            <InlineStack gap="200">
                              <Button variant="plain" url={`/app/customize/${meta.id}`} size="slim">
                                Personalize
                              </Button>
                              <Button
                                variant={isActive ? "plain" : "primary"}
                                disabled={isActive || isSavingThis}
                                loading={isSavingThis}
                                onClick={() => isLocked ? navigate("/app/billing") : handleSelectInvoice(meta.id)}
                                size="slim"
                              >
                                {isLocked ? "Upgrade" : isActive ? "Selected" : "Use Template"}
                              </Button>
                            </InlineStack>
                          </InlineStack>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            )}

            {/* ── Packing Slip tab ── */}
            {selectedTab === 1 && (
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose a packing slip template. This is independent of your invoice template — you can mix and match styles.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  {PACKING_SLIP_META.map((meta) => {
                    const isActive = activeSlipTemplateId === meta.id;
                    const isSavingThis = isSaving && pendingSlipTemplate === meta.id;
                    return (
                      <div key={meta.id} style={{ border: isActive ? `2px solid ${meta.primaryColor}` : "1.5px solid #e0e0e0", borderRadius: 8, overflow: "hidden", background: "#fff", boxShadow: isActive ? `0 0 0 3px ${meta.bgColor}` : "none", transition: "box-shadow 0.15s" }}>
                        <div style={{ padding: "12px 12px 0" }}>
                          <PackingSlipThumbnail meta={meta} />
                        </div>
                        <div style={{ padding: "10px 14px 12px" }}>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: meta.primaryColor, flexShrink: 0 }} />
                                <Text as="h3" variant="headingSm">{meta.name}</Text>
                                {isActive && <Badge tone="success">Active</Badge>}
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">{meta.description}</Text>
                            </BlockStack>
                            <Button
                              variant={isActive ? "plain" : "primary"}
                              disabled={isActive || isSavingThis}
                              loading={isSavingThis}
                              onClick={() => handleSelectSlip(meta.id)}
                              size="slim"
                            >
                              {isActive ? "Selected" : "Use Template"}
                            </Button>
                          </InlineStack>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            )}

            {/* ── Draft Order tab ── */}
            {selectedTab === 2 && (
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Draft orders use a dedicated Estimate / Quotation template.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  <SingleTemplateCard
                    name="Quotation"
                    description="Amber gold design — clearly distinguished from tax invoices. Includes GST disclaimer and validity badge."
                    accentColor="#E65100"
                    bgColor="#FFF3E0"
                  />
                </div>
              </BlockStack>
            )}

            {/* ── Refund / Credit Note tab ── */}
            {selectedTab === 3 && (
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Refunds / credit notes use a dedicated Credit Note template.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  <SingleTemplateCard
                    name="Credit Note"
                    description="Red accent design — clearly distinguished from regular invoices. Shows refunded items and total credit amount."
                    accentColor="#C62828"
                    bgColor="#FFEBEE"
                  />
                </div>
              </BlockStack>
            )}

          </Box>
        </Tabs>

      </BlockStack>
    </Page>
  );
}
