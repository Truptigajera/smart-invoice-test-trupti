import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Select, Banner, FormLayout, InlineStack,
  Checkbox, Toast, Frame, Tabs, Box, Divider,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useRef, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { validateGstin, getStateCodeFromGstin, STATE_CODES, VALID_GST_RATES, isValidGstRate } from "~/lib/gst";
import { financialYearLabel } from "~/lib/invoice-number.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, include: { settings: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  if (!shop.settings) {
    await prisma.shopSettings.create({ data: { shopId: shop.id } });
    shop = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id }, include: { settings: true } });
  }
  return json({
    shop,
    currentFy: financialYearLabel(),
    gstinLookupEnabled: Boolean(process.env.GSTIN_API_URL),
  });
};

// GST allows invoice numbers of at most 16 characters. Longest prefix that still fits once the
// serial reaches 4 digits (or more, if the counter is already past 9999). Order numbers: up to 6 digits.
function maxPrefixLength(type: string, includeFinancialYear: boolean, counter: number) {
  if (type === "order_number") return 16 - 1 - 6;
  const serialDigits = Math.max(4, String(counter).length);
  return 16 - serialDigits - (includeFinancialYear ? 7 : 1); // "/26-27/" vs "-"
}

// ─── Action ──────────────────────────────────────────────────────────────────

const ok = (success: string, extra: Record<string, unknown> = {}) => json({ success, ...extra });
const fail = (error: string) => json({ error });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const str = (k: string) => ((formData.get(k) as string) || "").trim();

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shopRecord) return json({ error: "Shop not found" }, { status: 404 });
  const upsertSettings = (data: Record<string, unknown>) =>
    prisma.shopSettings.upsert({ where: { shopId: shopRecord.id }, create: { shopId: shopRecord.id, ...data }, update: data });

  if (intent === "save-business") {
    const gstin = str("gstin").toUpperCase();
    if (gstin && !validateGstin(gstin)) return fail("This GSTIN is not valid — please check it on your GST certificate.");
    const businessName = str("businessName");
    if (!businessName) return fail("Business name is required — it is printed on every invoice.");
    // The seller's state decides CGST+SGST vs IGST on every invoice; with a GSTIN it comes from its first 2 digits
    const stateCode = gstin ? getStateCodeFromGstin(gstin) : str("stateCode");
    if (!STATE_CODES[stateCode]) return fail("Please select your business state.");
    const pincode = str("pincode");
    if (pincode && !/^\d{6}$/.test(pincode)) return fail("Pincode must be 6 digits.");

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        gstin: gstin || null, businessName,
        address: str("address") || null, city: str("city") || null,
        state: STATE_CODES[stateCode], stateCode, pincode: pincode || null,
        phone: str("phone") || null, email: str("email") || null,
      },
    });
    await upsertSettings({ useBillingAsShipping: formData.get("useBillingAsShipping") === "true" });
    return ok("Business details saved");
  }

  if (intent === "save-invoice-format") {
    const prefix = str("invoicePrefix").toUpperCase() || "INV";
    if (!/^[A-Z0-9/-]{1,10}$/.test(prefix)) return fail("Prefix can have up to 10 letters, numbers, \"-\" or \"/\".");
    const type = str("invoiceNumberType") === "order_number" ? "order_number" : "custom";
    const includeFinancialYear = formData.get("includeFinancialYear") === "true";
    // GST: an invoice number may be at most 16 characters
    const maxPrefix = maxPrefixLength(type, includeFinancialYear, Math.max(shopRecord.invoiceCounter, parseInt(str("nextNumber") || "0", 10) || 0));
    if (prefix.length > maxPrefix) {
      return fail(`Prefix can be at most ${maxPrefix} characters with this format — GST allows invoice numbers of up to 16 characters.`);
    }

    const nextNumber = parseInt(str("nextNumber") || "0", 10);
    const shopUpdate: Record<string, unknown> = { invoicePrefix: prefix };
    if (nextNumber) {
      // Only move forward — going back would reuse numbers already on invoices
      if (nextNumber < shopRecord.invoiceCounter) {
        return fail(`Next number can't be lower than ${shopRecord.invoiceCounter} — earlier numbers are already used.`);
      }
      shopUpdate.invoiceCounter = nextNumber;
    }
    await prisma.shop.update({ where: { id: shopRecord.id }, data: shopUpdate });
    await upsertSettings({
      invoiceNumberType: type,
      includeFinancialYear,
      currencySymbol: str("currencySymbol") || "₹",
      dateFormat: str("dateFormat") || "DD-MM-YYYY",
    });
    return ok("Invoice number settings saved");
  }

  if (intent === "save-tax-settings") {
    const defaultGstRate = str("defaultGstRate") || "18";
    const shippingGstRate = str("shippingGstRate") || "18";
    const shippingHsnCode = str("shippingHsnCode") || "996812";
    if (!isValidGstRate(defaultGstRate) || !isValidGstRate(shippingGstRate)) return fail("Please choose a valid GST rate.");
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(shippingHsnCode)) return fail("Shipping SAC/HSN code must be 4, 6 or 8 digits (courier services: 996812).");
    await upsertSettings({
      defaultGstRate: parseFloat(defaultGstRate),
      useDefaultGstRate: formData.get("useDefaultGstRate") === "true",
      shippingGstEnabled: formData.get("shippingGstEnabled") === "true",
      shippingGstRate: parseFloat(shippingGstRate),
      shippingHsnCode,
    });
    return ok("Tax settings saved");
  }

  if (intent === "save-email") {
    await upsertSettings({
      autoEmailEnabled: formData.get("autoEmailEnabled") === "true",
      emailTrigger: str("emailTrigger") === "paid" ? "paid" : "fulfilled",
      emailSubject: str("emailSubject") || "Your GST Invoice - {invoice_number}",
      emailBody: str("emailBody") || null,
    });
    return ok("Email settings saved");
  }

  if (intent === "test-email") {
    const toEmail = str("testEmail");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return fail("Please enter a valid email address.");
    const { sendInvoiceEmail } = await import("~/lib/email.server");
    try {
      await sendInvoiceEmail({
        shopId: shopRecord.id, invoiceId: "test", toEmail, toName: "Test Customer",
        invoiceNumber: "TEST-0001", pdfUrl: "", subject: "Test email — your invoice emails are working",
      });
      return ok(`Test email sent to ${toEmail}`);
    } catch (err) {
      return fail(`Test email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (intent === "upload-logo" || intent === "upload-signature") {
    const field = intent === "upload-logo" ? "logo" : "signature";
    const fileBase64 = formData.get("fileBase64") as string | null;
    const fileMime = str("fileMime");
    if (!fileBase64) return fail("No file selected.");
    // PDFs can only embed PNG / JPEG — a WebP logo silently disappeared from every invoice
    if (!["image/png", "image/jpeg"].includes(fileMime)) return fail("Please upload a PNG or JPG image.");
    if (Buffer.from(fileBase64, "base64").length > 2 * 1024 * 1024) return fail("File is too large — maximum 2 MB.");
    const dataUrl = `data:${fileMime};base64,${fileBase64}`;
    await prisma.shop.update({ where: { id: shopRecord.id }, data: field === "logo" ? { logoUrl: dataUrl } : { signatureUrl: dataUrl } });
    return ok(`${field === "logo" ? "Logo" : "Signature"} uploaded`, { uploadedUrl: dataUrl, uploadedField: field });
  }

  if (intent === "remove-logo" || intent === "remove-signature") {
    await prisma.shop.update({ where: { id: shopRecord.id }, data: intent === "remove-logo" ? { logoUrl: null } : { signatureUrl: null } });
    return ok(intent === "remove-logo" ? "Logo removed" : "Signature removed", { removedField: intent === "remove-logo" ? "logo" : "signature" });
  }

  if (intent === "save-custom-fields") {
    await upsertSettings({ customFields: (formData.get("customFields") as string) || "[]" });
    return ok("Custom fields saved");
  }

  if (intent === "save-einvoice") {
    const data: Record<string, unknown> = {
      eInvoiceEnabled: formData.get("eInvoiceEnabled") === "true",
      eInvoiceSandbox: formData.get("eInvoiceSandbox") === "true",
      eInvoiceClientId: str("eInvoiceClientId") || null,
      eInvoiceApiUser: str("eInvoiceApiUser") || null,
    };
    // Secrets are never sent back to the browser, so an empty box means "keep the saved one"
    // (the client secret used to be wiped every time the form was saved)
    if (str("eInvoiceClientSecret")) data.eInvoiceClientSecret = str("eInvoiceClientSecret");
    if (str("eInvoiceApiPass")) data.eInvoiceApiPass = str("eInvoiceApiPass");
    await upsertSettings(data);
    return ok("E-Invoice settings saved");
  }

  return fail("Unknown action");
};

// ─── Component ───────────────────────────────────────────────────────────────

type Result = { success?: string; error?: string; uploadedUrl?: string; uploadedField?: string; removedField?: string };

const TABS = [
  { id: "business", content: "Business" },
  { id: "invoice", content: "Invoice numbers" },
  { id: "tax", content: "Tax" },
  { id: "email", content: "Email" },
  { id: "branding", content: "Logo & signature" },
  { id: "advanced", content: "Advanced" },
];

const stateOptions = [
  { label: "Select state", value: "" },
  ...Object.entries(STATE_CODES).map(([code, name]) => ({ label: `${name} (${code})`, value: code }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];
const rateOptions = VALID_GST_RATES.map((r) => ({ label: `${r}%`, value: r }));

// Section layout: title + explanation on the left, form on the right
function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <InlineStack gap="600" align="start" blockAlign="start" wrap>
      <div style={{ flex: "1 1 220px", maxWidth: 300 }}>
        <BlockStack gap="100">
          <Text as="h2" variant="headingSm">{title}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
        </BlockStack>
      </div>
      <div style={{ flex: "3 1 420px", minWidth: 0 }}>
        <Card>{children}</Card>
      </div>
    </InlineStack>
  );
}

export default function SettingsPage() {
  const { shop, currentFy, gstinLookupEnabled } = useLoaderData<typeof loader>();
  const s = shop.settings!;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTab = Math.max(0, TABS.findIndex((t) => t.id === searchParams.get("tab")));
  const fetcher = useFetcher<Result>();
  const busy = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;

  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (d?.error) setToast({ msg: d.error, error: true });
    else if (d?.success) setToast({ msg: d.success });
  }, [fetcher.data]);

  const submit = (intent: string, data: Record<string, string>) => fetcher.submit({ intent, ...data }, { method: "post" });

  // ── Business ──
  const [biz, setBiz] = useState({
    gstin: shop.gstin ?? "", businessName: shop.businessName ?? "", address: shop.address ?? "",
    city: shop.city ?? "", stateCode: shop.stateCode ?? "", pincode: shop.pincode ?? "",
    phone: shop.phone ?? "", email: shop.email ?? "",
    useBillingAsShipping: s.useBillingAsShipping !== false ? "true" : "false",
  });
  const setB = (k: keyof typeof biz) => (v: string) => setBiz((b) => ({ ...b, [k]: v }));
  const gstinInvalid = biz.gstin.length === 15 && !validateGstin(biz.gstin);
  const gstinState = biz.gstin.length >= 2 && STATE_CODES[biz.gstin.slice(0, 2)] ? biz.gstin.slice(0, 2) : "";
  const gstinFetcher = useFetcher<{ businessName?: string | null; tradeName?: string | null; address?: string | null; city?: string | null; pincode?: string | null; fromApi?: boolean }>();
  useEffect(() => {
    const d = gstinFetcher.data;
    if (!d?.fromApi) return;
    setBiz((b) => ({
      ...b,
      businessName: d.tradeName || d.businessName || b.businessName,
      address: d.address || b.address, city: d.city || b.city, pincode: d.pincode || b.pincode,
    }));
  }, [gstinFetcher.data]);

  // ── Invoice numbers ──
  const [inv, setInv] = useState({
    invoiceNumberType: s.invoiceNumberType === "order_number" ? "order_number" : "custom",
    invoicePrefix: shop.invoicePrefix || "INV",
    includeFinancialYear: s.includeFinancialYear === true,
    nextNumber: "",
    currencySymbol: s.currencySymbol || "₹",
    dateFormat: s.dateFormat || "DD-MM-YYYY",
  });
  const previewCounter = Number(inv.nextNumber) || shop.invoiceCounter;
  const invoicePreview = inv.invoiceNumberType === "order_number"
    ? `${inv.invoicePrefix || "INV"}-1430`
    : inv.includeFinancialYear
      ? `${inv.invoicePrefix || "INV"}/${currentFy}/${String(previewCounter).padStart(4, "0")}`
      : `${inv.invoicePrefix || "INV"}-${String(previewCounter).padStart(4, "0")}`;
  const maxPrefix = maxPrefixLength(inv.invoiceNumberType, inv.includeFinancialYear, Math.max(shop.invoiceCounter, previewCounter));
  const prefixTooLong = (inv.invoicePrefix || "INV").length > maxPrefix;

  // ── Tax ──
  const [tax, setTax] = useState({
    defaultGstRate: String(s.defaultGstRate ?? 18),
    useDefaultGstRate: s.useDefaultGstRate !== false,
    shippingGstEnabled: !!s.shippingGstEnabled,
    shippingGstRate: String(s.shippingGstRate ?? 18),
    shippingHsnCode: s.shippingHsnCode || "996812",
  });

  // ── Email ──
  const [mail, setMail] = useState({
    autoEmailEnabled: !!s.autoEmailEnabled,
    emailTrigger: s.emailTrigger === "paid" ? "paid" : "fulfilled",
    emailSubject: s.emailSubject || "Your GST Invoice - {invoice_number}",
    emailBody: s.emailBody || "",
  });
  const [testEmail, setTestEmail] = useState("");

  // ── Logo & signature ──
  const [logo, setLogo] = useState<string | null>(shop.logoUrl);
  const [signature, setSignature] = useState<string | null>(shop.signatureUrl);
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (d?.uploadedField === "logo") setLogo(d.uploadedUrl ?? null);
    if (d?.uploadedField === "signature") setSignature(d.uploadedUrl ?? null);
    if (d?.removedField === "logo") setLogo(null);
    if (d?.removedField === "signature") setSignature(null);
  }, [fetcher.data]);
  const upload = (file: File, field: "logo" | "signature") => {
    if (!["image/png", "image/jpeg"].includes(file.type)) return setToast({ msg: "Please choose a PNG or JPG image.", error: true });
    const reader = new FileReader();
    reader.onload = (e) => {
      const [, base64] = String(e.target?.result || "").split(",");
      submit(`upload-${field}`, { fileBase64: base64, fileMime: file.type });
    };
    reader.readAsDataURL(file);
  };

  // ── Advanced ──
  type CustomFieldDef = { key: string; label: string; type: "text" | "date" | "number" };
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(() => {
    try { return JSON.parse(s.customFields || "[]"); } catch { return []; }
  });
  const [einv, setEinv] = useState({
    eInvoiceEnabled: !!s.eInvoiceEnabled, eInvoiceSandbox: s.eInvoiceSandbox !== false,
    eInvoiceClientId: s.eInvoiceClientId ?? "", eInvoiceClientSecret: "", eInvoiceApiUser: s.eInvoiceApiUser ?? "", eInvoiceApiPass: "",
  });

  const imageBlock = (label: string, field: "logo" | "signature", src: string | null, ref: React.RefObject<HTMLInputElement>, hint: string) => (
    <BlockStack gap="200">
      <Text as="h3" variant="headingXs">{label}</Text>
      <InlineStack gap="300" blockAlign="center">
        <div style={{ width: 88, height: 88, border: "1px solid #e1e3e5", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fafafa" }}>
          {src ? <img src={src} alt={label} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <Text as="span" variant="bodySm" tone="subdued">None</Text>}
        </div>
        <BlockStack gap="100">
          <input ref={ref} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, field); e.target.value = ""; }} />
          <InlineStack gap="200">
            <Button size="slim" loading={busy === `upload-${field}`} onClick={() => ref.current?.click()}>{src ? "Change" : "Upload"}</Button>
            {src && <Button size="slim" icon={DeleteIcon} tone="critical" variant="plain" loading={busy === `remove-${field}`} onClick={() => submit(`remove-${field}`, {})} accessibilityLabel={`Remove ${label}`} />}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>
        </BlockStack>
      </InlineStack>
    </BlockStack>
  );

  const tab = TABS[selectedTab].id;

  return (
    <Frame>
      {toast && <Toast content={toast.msg} error={toast.error} onDismiss={() => setToast(null)} />}
      <Page title="Settings" fullWidth>
        <TitleBar title="Settings" />
        <Card padding="0">
          <Tabs tabs={TABS} selected={selectedTab} onSelect={(i) => setSearchParams({ tab: TABS[i].id })}>
            <Box padding="500">
              <BlockStack gap="500">

                {tab === "business" && (
                  <Section title="Business details" description="Printed on every invoice. Your state decides whether orders get CGST + SGST (same state) or IGST (other states).">
                    <FormLayout>
                      <TextField
                        label="GSTIN" value={biz.gstin} autoComplete="off" maxLength={15}
                        onChange={(v) => setB("gstin")(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))}
                        error={gstinInvalid ? "This GSTIN is not valid" : undefined}
                        helpText="Leave empty if you are not GST registered."
                        connectedRight={gstinLookupEnabled ? (
                          <Button onClick={() => gstinFetcher.load(`/api/gstin-lookup?gstin=${biz.gstin}`)} disabled={biz.gstin.length !== 15 || gstinInvalid} loading={gstinFetcher.state === "loading"}>Fetch details</Button>
                        ) : undefined}
                      />
                      <TextField label="Business name" requiredIndicator value={biz.businessName} onChange={setB("businessName")} autoComplete="organization" />
                      <TextField label="Address" value={biz.address} onChange={setB("address")} multiline={2} autoComplete="street-address" />
                      <FormLayout.Group>
                        <TextField label="City" value={biz.city} onChange={setB("city")} autoComplete="address-level2" />
                        {/* Was a select that couldn't be changed (empty onChange) — merchants without a GSTIN had no state */}
                        <Select
                          label="State" requiredIndicator options={stateOptions}
                          value={gstinState || biz.stateCode} onChange={setB("stateCode")} disabled={!!gstinState}
                          helpText={gstinState ? "From your GSTIN" : undefined}
                        />
                        <TextField label="Pincode" value={biz.pincode} onChange={(v) => setB("pincode")(v.replace(/\D/g, "").slice(0, 6))} autoComplete="postal-code" inputMode="numeric" />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <TextField label="Phone" value={biz.phone} onChange={setB("phone")} autoComplete="tel" />
                        <TextField label="Email" type="email" value={biz.email} onChange={setB("email")} autoComplete="email" />
                      </FormLayout.Group>
                      <Select
                        label="Customer address on invoice"
                        options={[
                          { label: "Billing address", value: "true" },
                          { label: "Shipping address", value: "false" },
                        ]}
                        value={biz.useBillingAsShipping} onChange={setB("useBillingAsShipping")}
                      />
                      <InlineStack>
                        <Button variant="primary" loading={busy === "save-business"} disabled={gstinInvalid || !biz.businessName.trim()} onClick={() => submit("save-business", biz)}>Save</Button>
                      </InlineStack>
                    </FormLayout>
                  </Section>
                )}

                {tab === "invoice" && (
                  <Section title="Invoice numbers" description="GST invoice numbers must be unique and in sequence within a financial year, and at most 16 characters.">
                    <FormLayout>
                      <Select
                        label="Numbering"
                        options={[
                          { label: "Running number (recommended)", value: "custom" },
                          { label: "Same as the Shopify order number", value: "order_number" },
                        ]}
                        value={inv.invoiceNumberType}
                        onChange={(v) => setInv((x) => ({ ...x, invoiceNumberType: v }))}
                        helpText={inv.invoiceNumberType === "order_number"
                          ? "Unpaid or cancelled orders leave gaps in the numbering — a running number avoids that."
                          : undefined}
                      />
                      <FormLayout.Group>
                        <TextField
                          label="Prefix" value={inv.invoicePrefix} autoComplete="off"
                          onChange={(v) => setInv((x) => ({ ...x, invoicePrefix: v.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 10) }))}
                          error={prefixTooLong ? `Too long — max ${maxPrefix} characters with this format` : undefined}
                          helpText={prefixTooLong ? undefined : `Up to ${maxPrefix} characters, e.g. INV or ${inv.includeFinancialYear ? "SHOP" : "INV-A"}`}
                        />
                        {inv.invoiceNumberType === "custom" && (
                          <TextField
                            label="Next invoice number" type="number" value={inv.nextNumber} autoComplete="off"
                            placeholder={String(shop.invoiceCounter)}
                            onChange={(v) => setInv((x) => ({ ...x, nextNumber: v.replace(/\D/g, "") }))}
                            helpText="Moving from another app? Continue from your last number."
                          />
                        )}
                      </FormLayout.Group>
                      {inv.invoiceNumberType === "custom" && (
                        <Checkbox
                          label={`Add the financial year and restart numbering every April (e.g. ${inv.invoicePrefix || "INV"}/${currentFy}/0001)`}
                          checked={inv.includeFinancialYear}
                          onChange={(v) => setInv((x) => ({ ...x, includeFinancialYear: v }))}
                        />
                      )}
                      <Banner tone={prefixTooLong ? "critical" : "info"}>
                        <Text as="p" variant="bodySm">
                          Next invoice: <strong>{invoicePreview}</strong> ({invoicePreview.length}/16 characters)
                          {prefixTooLong && " — GST allows at most 16 characters. Use a shorter prefix."}
                        </Text>
                      </Banner>
                      <FormLayout.Group>
                        <Select
                          label="Currency" value={inv.currencySymbol} onChange={(v) => setInv((x) => ({ ...x, currencySymbol: v }))}
                          options={[{ label: "₹ (symbol)", value: "₹" }, { label: "Rs.", value: "Rs." }, { label: "INR", value: "INR" }]}
                        />
                        <Select
                          label="Date format" value={inv.dateFormat} onChange={(v) => setInv((x) => ({ ...x, dateFormat: v }))}
                          options={[{ label: "15-01-2026", value: "DD-MM-YYYY" }, { label: "15/01/2026", value: "DD/MM/YYYY" }, { label: "Jan 15, 2026", value: "MMM DD YYYY" }]}
                        />
                      </FormLayout.Group>
                      <InlineStack>
                        <Button variant="primary" loading={busy === "save-invoice-format"} disabled={prefixTooLong}
                          onClick={() => submit("save-invoice-format", { ...inv, includeFinancialYear: String(inv.includeFinancialYear) })}>Save</Button>
                      </InlineStack>
                    </FormLayout>
                  </Section>
                )}

                {tab === "tax" && (
                  <>
                    <Section title="Product GST" description="Rates set per product in Products & HSN always win. These apply only when a product has no rate and Shopify charged no tax.">
                      <FormLayout>
                        <Checkbox
                          label="Use a default GST rate for products without one"
                          helpText="Off: such products are invoiced at 0% (exempt)."
                          checked={tax.useDefaultGstRate} onChange={(v) => setTax((t) => ({ ...t, useDefaultGstRate: v }))}
                        />
                        {tax.useDefaultGstRate && (
                          <Select label="Default GST rate" options={rateOptions} value={tax.defaultGstRate} onChange={(v) => setTax((t) => ({ ...t, defaultGstRate: v }))} />
                        )}
                      </FormLayout>
                    </Section>
                    <Divider />
                    <Section title="Shipping GST" description="Used when Shopify didn't charge tax on shipping. Shipping is reported under its SAC code in GST returns.">
                      <FormLayout>
                        <Checkbox
                          label="Charge GST on shipping"
                          checked={tax.shippingGstEnabled} onChange={(v) => setTax((t) => ({ ...t, shippingGstEnabled: v }))}
                        />
                        <FormLayout.Group>
                          <Select label="Shipping GST rate" options={rateOptions} value={tax.shippingGstRate} disabled={!tax.shippingGstEnabled} onChange={(v) => setTax((t) => ({ ...t, shippingGstRate: v }))} />
                          <TextField label="Shipping SAC code" value={tax.shippingHsnCode} autoComplete="off" helpText="Courier services: 996812"
                            onChange={(v) => setTax((t) => ({ ...t, shippingHsnCode: v.replace(/\D/g, "").slice(0, 8) }))} />
                        </FormLayout.Group>
                        <InlineStack>
                          <Button variant="primary" loading={busy === "save-tax-settings"} onClick={() => submit("save-tax-settings", {
                            defaultGstRate: tax.defaultGstRate, useDefaultGstRate: String(tax.useDefaultGstRate),
                            shippingGstEnabled: String(tax.shippingGstEnabled), shippingGstRate: tax.shippingGstRate, shippingHsnCode: tax.shippingHsnCode,
                          })}>Save</Button>
                        </InlineStack>
                      </FormLayout>
                    </Section>
                  </>
                )}

                {tab === "email" && (
                  <>
                    <Section title="Invoice emails" description="Send customers their GST invoice automatically.">
                      <FormLayout>
                        <Checkbox label="Email the invoice to customers automatically" checked={mail.autoEmailEnabled} onChange={(v) => setMail((m) => ({ ...m, autoEmailEnabled: v }))} />
                        <Select
                          label="Send when" disabled={!mail.autoEmailEnabled}
                          options={[{ label: "The order is paid", value: "paid" }, { label: "The order is fulfilled", value: "fulfilled" }]}
                          value={mail.emailTrigger} onChange={(v) => setMail((m) => ({ ...m, emailTrigger: v }))}
                        />
                        <TextField label="Subject" value={mail.emailSubject} onChange={(v) => setMail((m) => ({ ...m, emailSubject: v }))} autoComplete="off" helpText="{invoice_number} is replaced with the invoice number." />
                        <TextField label="Message" value={mail.emailBody} onChange={(v) => setMail((m) => ({ ...m, emailBody: v }))} multiline={4} autoComplete="off" helpText="Leave empty for the standard message." />
                        <InlineStack>
                          <Button variant="primary" loading={busy === "save-email"} onClick={() => submit("save-email", { ...mail, autoEmailEnabled: String(mail.autoEmailEnabled) })}>Save</Button>
                        </InlineStack>
                      </FormLayout>
                    </Section>
                    <Divider />
                    <Section title="Test & sending" description="Check that emails reach customers, or send them from your own email address.">
                      <BlockStack gap="400">
                        <TextField
                          label="Send a test email to" type="email" value={testEmail} onChange={setTestEmail} autoComplete="email"
                          connectedRight={<Button loading={busy === "test-email"} onClick={() => submit("test-email", { testEmail })}>Send test</Button>}
                        />
                        <InlineStack align="space-between" blockAlign="center" gap="300">
                          <Text as="p" variant="bodySm" tone="subdued">Want invoices to come from your own email address (Gmail, Zoho, etc.)?</Text>
                          <Button url="/app/settings/smtp">Set up your own email (SMTP)</Button>
                        </InlineStack>
                      </BlockStack>
                    </Section>
                  </>
                )}

                {tab === "branding" && (
                  <Section title="Logo & signature" description="Shown on invoices, packing slips, estimates and credit notes. PNG or JPG, up to 2 MB.">
                    <BlockStack gap="500">
                      {imageBlock("Business logo", "logo", logo, logoRef, "A transparent PNG looks best.")}
                      <Divider />
                      {imageBlock("Authorised signature", "signature", signature, sigRef, "Without one, invoices show a blank space to sign by hand.")}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">Change the invoice design or colours in Templates.</Text>
                        <Button url="/app/templates">Open Templates</Button>
                      </InlineStack>
                    </BlockStack>
                  </Section>
                )}

                {tab === "advanced" && (
                  <>
                    <Section title="Custom invoice fields" description="Extra fields you fill in per invoice — PO number, e-way bill no., vehicle no. Up to 6.">
                      <BlockStack gap="300">
                        {customFields.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No custom fields yet.</Text>}
                        {customFields.map((field, idx) => (
                          <InlineStack key={field.key} gap="300" blockAlign="center" wrap={false}>
                            <div style={{ flex: 1 }}>
                              <TextField label="Label" labelHidden placeholder="e.g. PO Number" value={field.label} autoComplete="off"
                                onChange={(v) => setCustomFields((f) => f.map((x, i) => (i === idx ? { ...x, label: v } : x)))} />
                            </div>
                            <div style={{ width: 130 }}>
                              <Select label="Type" labelHidden value={field.type}
                                options={[{ label: "Text", value: "text" }, { label: "Date", value: "date" }, { label: "Number", value: "number" }]}
                                onChange={(v) => setCustomFields((f) => f.map((x, i) => (i === idx ? { ...x, type: v as CustomFieldDef["type"] } : x)))} />
                            </div>
                            <Button tone="critical" variant="plain" onClick={() => setCustomFields((f) => f.filter((_, i) => i !== idx))}>Remove</Button>
                          </InlineStack>
                        ))}
                        <InlineStack gap="300">
                          {customFields.length < 6 && (
                            <Button onClick={() => setCustomFields((f) => [...f, { key: `field_${Date.now()}`, label: "", type: "text" }])}>+ Add field</Button>
                          )}
                          <Button variant="primary" loading={busy === "save-custom-fields"} onClick={() => {
                            const valid = customFields.filter((f) => f.label.trim()).map((f) => ({
                              // A field keeps its key once saved, so renaming the label doesn't lose values already entered
                              key: f.key.startsWith("field_") ? (f.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || f.key) : f.key,
                              label: f.label.trim(), type: f.type,
                            }));
                            submit("save-custom-fields", { customFields: JSON.stringify(valid) });
                          }}>Save</Button>
                        </InlineStack>
                      </BlockStack>
                    </Section>
                    <Divider />
                    <Section title="E-Invoice (IRN)" description="Required for businesses with turnover above ₹5 crore. Get API credentials from the NIC e-invoice portal (einvoice1.nic.in).">
                      <FormLayout>
                        <Checkbox label="Generate IRN for B2B invoices" checked={einv.eInvoiceEnabled} onChange={(v) => setEinv((e) => ({ ...e, eInvoiceEnabled: v }))} />
                        <Select label="Environment" value={einv.eInvoiceSandbox ? "sandbox" : "prod"}
                          options={[{ label: "Sandbox (testing)", value: "sandbox" }, { label: "Production (live)", value: "prod" }]}
                          onChange={(v) => setEinv((e) => ({ ...e, eInvoiceSandbox: v === "sandbox" }))} />
                        <FormLayout.Group>
                          <TextField label="Client ID" value={einv.eInvoiceClientId} onChange={(v) => setEinv((e) => ({ ...e, eInvoiceClientId: v }))} autoComplete="off" />
                          <TextField label="Client secret" type="password" value={einv.eInvoiceClientSecret} onChange={(v) => setEinv((e) => ({ ...e, eInvoiceClientSecret: v }))} autoComplete="off"
                            placeholder={s.eInvoiceClientSecret ? "Saved — leave empty to keep" : ""} />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label="API username" value={einv.eInvoiceApiUser} onChange={(v) => setEinv((e) => ({ ...e, eInvoiceApiUser: v }))} autoComplete="off" />
                          <TextField label="API password" type="password" value={einv.eInvoiceApiPass} onChange={(v) => setEinv((e) => ({ ...e, eInvoiceApiPass: v }))} autoComplete="off"
                            placeholder={s.eInvoiceApiPass ? "Saved — leave empty to keep" : ""} />
                        </FormLayout.Group>
                        <InlineStack>
                          <Button variant="primary" loading={busy === "save-einvoice"} onClick={() => submit("save-einvoice", {
                            ...einv, eInvoiceEnabled: String(einv.eInvoiceEnabled), eInvoiceSandbox: String(einv.eInvoiceSandbox),
                          })}>Save</Button>
                        </InlineStack>
                      </FormLayout>
                    </Section>
                  </>
                )}

              </BlockStack>
            </Box>
          </Tabs>
        </Card>
      </Page>
    </Frame>
  );
}
