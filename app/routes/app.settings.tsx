import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useFetcher } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  Select, Banner, Divider, FormLayout, InlineStack,
  ChoiceList, Toast, Frame, List,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useRef, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { validateGstin, getStateCodeFromGstin, STATE_CODES } from "~/lib/gst";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });
  // Ensure settings row exists
  if (shop && !shop.settings) {
    await prisma.shopSettings.create({ data: { shopId: shop.id } });
    return json({
      shop: { ...shop, settings: await prisma.shopSettings.findUnique({ where: { shopId: shop.id } }) },
    });
  }
  return json({ shop });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shopRecord) return json({ error: "Shop not found" }, { status: 404 });

  if (intent === "save-business") {
    const gstin = (formData.get("gstin") as string || "").toUpperCase().trim();
    if (gstin && !validateGstin(gstin)) {
      return json({ error: "Invalid GSTIN format. Please check and try again." });
    }
    const stateCode = gstin ? getStateCodeFromGstin(gstin) : (formData.get("stateCode") as string || "");

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        gstin: gstin || null,
        businessName: formData.get("businessName") as string || null,
        address: formData.get("address") as string || null,
        city: formData.get("city") as string || null,
        state: STATE_CODES[stateCode] ?? (formData.get("state") as string) ?? null,
        stateCode,
        pincode: formData.get("pincode") as string || null,
        phone: formData.get("phone") as string || null,
        email: formData.get("email") as string || null,
        invoicePrefix: formData.get("invoicePrefix") as string || "INV",
      },
    });
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        useBillingAsShipping: formData.get("useBillingAsShipping") === "true",
      },
      update: {
        useBillingAsShipping: formData.get("useBillingAsShipping") === "true",
      },
    });
    return json({ success: "Business details saved successfully!" });
  }

  if (intent === "save-email") {
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        autoEmailEnabled: formData.get("autoEmailEnabled") === "true",
        emailTrigger: formData.get("emailTrigger") as string || "fulfilled",
        emailSubject: formData.get("emailSubject") as string || "Your GST Invoice - {invoice_number}",
        emailBody: formData.get("emailBody") as string || null,
      },
      update: {
        autoEmailEnabled: formData.get("autoEmailEnabled") === "true",
        emailTrigger: formData.get("emailTrigger") as string || "fulfilled",
        emailSubject: formData.get("emailSubject") as string || "Your GST Invoice - {invoice_number}",
        emailBody: formData.get("emailBody") as string || null,
      },
    });
    return json({ success: "Email settings saved!" });
  }

  if (intent === "test-email") {
    const toEmail = (formData.get("testEmail") as string)?.trim();
    if (!toEmail) return json({ error: "Please enter a test email address" });

    const { sendInvoiceEmail } = await import("~/lib/email.server");
    try {
      await sendInvoiceEmail({
        shopId: shopRecord.id,
        invoiceId: "test",
        toEmail,
        toName: "Test Customer",
        invoiceNumber: "TEST-0001",
        pdfUrl: "",
        subject: "Test Email from GST Invoice Pro",
      });
      return json({ success: `Test email sent to ${toEmail}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `Failed to send test email: ${msg}` });
    }
  }

  if (intent === "upload-logo" || intent === "upload-signature") {
    const fieldName = intent === "upload-logo" ? "logo" : "signature";
    const fileBase64 = formData.get("fileBase64") as string | null;
    const fileName   = formData.get("fileName")   as string | null;
    const fileMime   = formData.get("fileMime")   as string | null;

    if (!fileBase64 || !fileName) {
      return json({ error: "No file selected. Please choose a file first." });
    }

    const ext = (fileName.split(".").pop() || "").toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      return json({ error: "Only JPG, PNG, or WebP files are allowed." });
    }

    const buffer = Buffer.from(fileBase64, "base64");
    if (buffer.length > 2 * 1024 * 1024) {
      return json({ error: "File is too large. Maximum size is 2 MB." });
    }

    const mime = fileMime || `image/${ext === "jpg" ? "jpeg" : ext}`;
    const dataUrl = `data:${mime};base64,${fileBase64}`;

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: fieldName === "logo" ? { logoUrl: dataUrl } : { signatureUrl: dataUrl },
    });

    const label = fieldName === "logo" ? "Logo" : "Signature";
    return json({ success: `${label} uploaded successfully!`, uploadedUrl: dataUrl, uploadedField: fieldName });
  }

  if (intent === "remove-logo") {
    await prisma.shop.update({ where: { id: shopRecord.id }, data: { logoUrl: null } });
    return json({ success: "Logo removed" });
  }

  if (intent === "remove-signature") {
    await prisma.shop.update({ where: { id: shopRecord.id }, data: { signatureUrl: null } });
    return json({ success: "Signature removed" });
  }

  if (intent === "save-invoice-format") {
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        invoiceNumberType: formData.get("invoiceNumberType") as string || "custom",
        invoiceSuffix: formData.get("invoiceSuffix") as string || null,
        invoiceStartNumber: parseInt(formData.get("invoiceStartNumber") as string || "1", 10),
        financialYearStart: parseInt(formData.get("financialYearStart") as string || "4", 10),
        currencySymbol: formData.get("currencySymbol") as string || "₹",
        dateFormat: formData.get("dateFormat") as string || "DD-MM-YYYY",
      },
      update: {
        invoiceNumberType: formData.get("invoiceNumberType") as string || "custom",
        invoiceSuffix: formData.get("invoiceSuffix") as string || null,
        invoiceStartNumber: parseInt(formData.get("invoiceStartNumber") as string || "1", 10),
        financialYearStart: parseInt(formData.get("financialYearStart") as string || "4", 10),
        currencySymbol: formData.get("currencySymbol") as string || "₹",
        dateFormat: formData.get("dateFormat") as string || "DD-MM-YYYY",
      },
    });
    // Also update prefix/suffix on Shop table
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { invoicePrefix: formData.get("invoicePrefix") as string || "INV" },
    });
    return json({ success: "Invoice format settings saved!" });
  }

  if (intent === "save-tax-settings") {
    const taxData = {
      taxAllProducts: formData.get("taxAllProducts") === "true",
      zeroTaxOnExports: formData.get("zeroTaxOnExports") === "true",
      compareAtPrice: formData.get("compareAtPrice") === "true",
      showReturnedItems: formData.get("showReturnedItems") === "true",
      taxSplitMethod: formData.get("taxSplitMethod") as string || "shipping",
      shippingGstEnabled: formData.get("shippingGstEnabled") === "true",
      shippingGstRate: parseFloat(formData.get("shippingGstRate") as string || "18"),
      shippingHsnCode: formData.get("shippingHsnCode") as string || "996812",
      defaultGstRate: parseFloat(formData.get("defaultGstRate") as string || "18"),
      useDefaultGstRate: formData.get("useDefaultGstRate") === "true",
    };
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: { shopId: shopRecord.id, ...taxData },
      update: taxData,
    });
    return json({ success: "Tax settings saved!" });
  }

  if (intent === "save-custom-fields") {
    const customFields = formData.get("customFields") as string || "[]";
    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: { shopId: shopRecord.id, customFields },
      update: { customFields },
    });
    return json({ success: "Custom fields saved!" });
  }

  if (intent === "save-einvoice") {
    const data: Record<string, any> = {
      eInvoiceEnabled:     formData.get("eInvoiceEnabled") === "true",
      eInvoiceSandbox:     formData.get("eInvoiceSandbox") === "true",
      eInvoiceClientId:    (formData.get("eInvoiceClientId")     as string || "").trim() || null,
      eInvoiceClientSecret:(formData.get("eInvoiceClientSecret") as string || "").trim() || null,
      eInvoiceApiUser:     (formData.get("eInvoiceApiUser")      as string || "").trim() || null,
    };
    // Only overwrite password if a new one was entered (mask-empty means no change)
    const newPass = (formData.get("eInvoiceApiPass") as string || "").trim();
    if (newPass) data.eInvoiceApiPass = newPass;

    await prisma.shopSettings.upsert({
      where:  { shopId: shopRecord.id },
      create: { shopId: shopRecord.id, ...data },
      update: data,
    });
    return json({ success: "E-Invoice settings saved!" });
  }

  return json({ error: "Unknown action" });
};

const stateOptions = [
  { label: "Select State", value: "" },
  ...Object.entries(STATE_CODES).map(([code, name]) => ({ label: name as string, value: code })),
];

export default function SettingsPage() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const [gstin, setGstin] = useState(shop?.gstin ?? "");
  const [businessName, setBusinessName] = useState(shop?.businessName ?? "");
  const [address, setAddress] = useState(shop?.address ?? "");
  const [city, setCity] = useState(shop?.city ?? "");
  const [pincode, setPincode] = useState(shop?.pincode ?? "");
  const [phone, setPhone] = useState(shop?.phone ?? "");
  const [email, setEmail] = useState(shop?.email ?? "");
  const [invoicePrefix, setInvoicePrefix] = useState(shop?.invoicePrefix ?? "INV");
  const [autoEmail, setAutoEmail] = useState(shop?.settings?.autoEmailEnabled ? "true" : "false");
  const [emailTrigger, setEmailTrigger] = useState(shop?.settings?.emailTrigger ?? "fulfilled");
  const [emailSubject, setEmailSubject] = useState(
    shop?.settings?.emailSubject ?? "Your GST Invoice - {invoice_number}"
  );
  const [emailBody, setEmailBody] = useState(shop?.settings?.emailBody ?? "");
  const [testEmailValue, setTestEmailValue] = useState("");

  const [logoPreview, setLogoPreview] = useState<string | null>(shop?.logoUrl ?? null);
  const [sigPreview, setSigPreview] = useState<string | null>(shop?.signatureUrl ?? null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  // Toast state — shown at bottom regardless of scroll position
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false);
  const showToast = (msg: string, err = false) => { setToastMsg(msg); setToastErr(err); };

  // Dedicated fetchers for logo / signature (avoid multipart, use base64)
  const logoFetcher = useFetcher<{ success?: string; error?: string; uploadedUrl?: string; uploadedField?: string }>();
  const sigFetcher  = useFetcher<{ success?: string; error?: string; uploadedUrl?: string; uploadedField?: string }>();

  const uploadViaBase64 = (
    file: File,
    fieldName: "logo" | "signature",
    fetcher: typeof logoFetcher,
  ) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const [header, base64] = dataUrl.split(",");
      const mime = header.replace("data:", "").replace(";base64", "");
      const fd = new FormData();
      fd.append("intent", `upload-${fieldName}`);
      fd.append("fileBase64", base64);
      fd.append("fileName", file.name);
      fd.append("fileMime", mime);
      fetcher.submit(fd, { method: "post" });
    };
    reader.readAsDataURL(file);
  };

  // Sync preview with loader data after upload / remove actions
  useEffect(() => { setLogoPreview(shop?.logoUrl ?? null); }, [shop?.logoUrl]);
  useEffect(() => { setSigPreview(shop?.signatureUrl ?? null); }, [shop?.signatureUrl]);

  // Show toast + update preview when logo/sig fetcher completes
  // Guard on uploadedField so a logo response can never bleed into sigPreview and vice-versa
  useEffect(() => {
    if (!logoFetcher.data) return;
    if (logoFetcher.data.error) showToast(logoFetcher.data.error, true);
    if (logoFetcher.data.success) showToast(logoFetcher.data.success);
    if (logoFetcher.data.uploadedUrl && logoFetcher.data.uploadedField === "logo")
      setLogoPreview(logoFetcher.data.uploadedUrl);
  }, [logoFetcher.data]);
  useEffect(() => {
    if (!sigFetcher.data) return;
    if (sigFetcher.data.error) showToast(sigFetcher.data.error, true);
    if (sigFetcher.data.success) showToast(sigFetcher.data.success);
    if (sigFetcher.data.uploadedUrl && sigFetcher.data.uploadedField === "signature")
      setSigPreview(sigFetcher.data.uploadedUrl);
  }, [sigFetcher.data]);

  // Show toast for all other section saves (actionData)
  useEffect(() => {
    if (!actionData) return;
    if ("error"   in actionData) showToast(actionData.error   as string, true);
    if ("success" in actionData) showToast(actionData.success as string);
  }, [actionData]);

  // Invoice Format Settings
  const [invoiceNumberType, setInvoiceNumberType] = useState([shop?.settings?.invoiceNumberType ?? "custom"]);
  const [invoiceSuffix, setInvoiceSuffix] = useState(shop?.settings?.invoiceSuffix ?? "");
  const [invoiceStartNumber, setInvoiceStartNumber] = useState(String(shop?.settings?.invoiceStartNumber ?? 1));
  const [financialYearStart, setFinancialYearStart] = useState(String(shop?.settings?.financialYearStart ?? 4));
  const [currencySymbol, setCurrencySymbol] = useState(shop?.settings?.currencySymbol ?? "₹");
  const [dateFormat, setDateFormat] = useState(shop?.settings?.dateFormat ?? "DD-MM-YYYY");

  // Tax Settings
  const [taxAllProducts, setTaxAllProducts] = useState([shop?.settings?.taxAllProducts !== false ? "true" : "false"]);
  const [zeroTaxOnExports, setZeroTaxOnExports] = useState([shop?.settings?.zeroTaxOnExports !== false ? "true" : "false"]);
  const [taxSplitMethod, setTaxSplitMethod] = useState([shop?.settings?.taxSplitMethod ?? "shipping"]);
  const [shippingGstEnabled, setShippingGstEnabled] = useState([shop?.settings?.shippingGstEnabled ? "true" : "false"]);
  const [shippingGstRate, setShippingGstRate] = useState(String(shop?.settings?.shippingGstRate ?? 18));
  const [shippingHsnCode, setShippingHsnCode] = useState(shop?.settings?.shippingHsnCode ?? "996812");
  const [defaultGstRate, setDefaultGstRate] = useState(String(shop?.settings?.defaultGstRate ?? 18));
  const [useDefaultGstRate, setUseDefaultGstRate] = useState(
    (shop?.settings as any)?.useDefaultGstRate !== false ? "true" : "false"
  );
  const [compareAtPrice, setCompareAtPrice] = useState([shop?.settings?.compareAtPrice ? "true" : "false"]);
  const [showReturnedItems, setShowReturnedItems] = useState([shop?.settings?.showReturnedItems ? "true" : "false"]);

  // Store Address
  const [useBillingAsShipping, setUseBillingAsShipping] = useState(
    shop?.settings?.useBillingAsShipping !== false ? "true" : "false"
  );

  // Custom Fields
  type CustomFieldDef = { key: string; label: string; type: "text" | "date" | "number" };
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>(() => {
    try { return JSON.parse(shop?.settings?.customFields || "[]"); } catch { return []; }
  });
  const customFieldsFetcher = useFetcher<{ success?: string; error?: string }>();

  // E-Invoice
  const [eInvoiceEnabled,      setEInvoiceEnabled]      = useState(shop?.settings?.eInvoiceEnabled ?? false);
  const [eInvoiceSandbox,      setEInvoiceSandbox]      = useState(shop?.settings?.eInvoiceSandbox ?? true);
  const [eInvoiceClientId,     setEInvoiceClientId]     = useState(shop?.settings?.eInvoiceClientId ?? "");
  const [eInvoiceClientSecret, setEInvoiceClientSecret] = useState("");  // never pre-fill secrets
  const [eInvoiceApiUser,      setEInvoiceApiUser]      = useState(shop?.settings?.eInvoiceApiUser ?? "");
  const [eInvoiceApiPass,      setEInvoiceApiPass]      = useState("");  // never pre-fill passwords
  const einvoiceFetcher = useFetcher<{ success?: string; error?: string }>();

  // GSTIN lookup fetcher (shared for Business Details + Store Address sections)
  const gstinFetcher = useFetcher<{
    stateCode?: string; state?: string; businessName?: string | null;
    tradeName?: string | null; address?: string | null; city?: string | null;
    pincode?: string | null; fromApi?: boolean; error?: string;
  }>();
  const isFetchingGstin = gstinFetcher.state === "loading";

  useEffect(() => {
    const d = gstinFetcher.data;
    if (!d || d.error) return;
    if (d.businessName) setBusinessName(d.tradeName || d.businessName);
    if (d.address) setAddress(d.address);
    if (d.city) setCity(d.city);
    if (d.pincode) setPincode(d.pincode);
  }, [gstinFetcher.data]);

  const handleFetchGstin = () => {
    if (gstin.length === 15) {
      gstinFetcher.load(`/api/gstin-lookup?gstin=${encodeURIComponent(gstin)}`);
    }
  };

  // Preview
  const currentFY = (() => {
    const now = new Date();
    const fyMonth = shop?.settings?.financialYearStart ?? 4;
    const yr = now.getMonth() + 1 >= fyMonth ? now.getFullYear() : now.getFullYear() - 1;
    return `${yr}-${String(yr + 1).slice(2)}`;
  })();
  const invoicePreview = invoiceNumberType[0] === "order_number"
    ? `#1234`
    : `${invoicePrefix || "INV"}${invoiceSuffix ? `-${invoiceSuffix}` : ""}-0001`;

  const gstinStateCode = gstin.length >= 2 ? gstin.substring(0, 2) : "";
  const detectedState = gstinStateCode ? (STATE_CODES[gstinStateCode] ?? "") : "";

  return (
    <Frame>
      {toastMsg && (
        <Toast
          content={toastMsg}
          error={toastErr}
          onDismiss={() => setToastMsg(null)}
        />
      )}
    <Page title="Settings">
      <TitleBar title="Settings" />
      <BlockStack gap="500">

        {/* Business Details */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Business Details</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Your GSTIN and business information will appear on all invoices.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="save-business" />
                <FormLayout>
                  <TextField
                    label="GSTIN"
                    name="gstin"
                    value={gstin}
                    onChange={(v) => setGstin(v.toUpperCase().slice(0, 15))}
                    placeholder="15-character GSTIN"
                    helpText="15-character GST Identification Number."
                    maxLength={15}
                    autoComplete="off"
                    connectedRight={
                      <Button
                        onClick={handleFetchGstin}
                        disabled={gstin.length !== 15 || isFetchingGstin}
                        loading={isFetchingGstin}
                        variant="secondary"
                      >
                        Fetch Details
                      </Button>
                    }
                  />
                  {detectedState && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      State: <strong>{detectedState}</strong> (Code: {gstinStateCode})
                      {gstinFetcher.data?.fromApi && " · Details fetched from GST registry"}
                    </Text>
                  )}
                  {gstinFetcher.data?.error && (
                    <Banner tone="critical">{gstinFetcher.data.error}</Banner>
                  )}
                  <TextField
                    label="Business Name"
                    name="businessName"
                    value={businessName}
                    onChange={setBusinessName}
                    autoComplete="off"
                  />
                  <TextField
                    label="Address"
                    name="address"
                    value={address}
                    onChange={setAddress}
                    multiline={2}
                    autoComplete="off"
                  />
                  <FormLayout.Group>
                    <TextField label="City" name="city" value={city} onChange={setCity} autoComplete="off" />
                    <TextField label="Pincode" name="pincode" value={pincode} onChange={setPincode} autoComplete="off" />
                  </FormLayout.Group>
                  <Select
                    label="State"
                    name="stateCode"
                    options={stateOptions}
                    value={gstinStateCode || (shop?.stateCode ?? "")}
                    onChange={() => {}}
                  />
                  <FormLayout.Group>
                    <TextField label="Phone" name="phone" value={phone} onChange={setPhone} autoComplete="off" />
                    <TextField label="Email" name="email" value={email} onChange={setEmail} type="email" autoComplete="off" />
                  </FormLayout.Group>
                  <TextField
                    label="Invoice Number Prefix"
                    name="invoicePrefix"
                    value={invoicePrefix}
                    onChange={setInvoicePrefix}
                    helpText={`Invoices will be numbered as ${invoicePrefix || "INV"}-0001, ${invoicePrefix || "INV"}-0002...`}
                    autoComplete="off"
                  />
                  <Select
                    label="Buyer Address on Invoice"
                    name="useBillingAsShipping"
                    options={[
                      { label: "Use Billing Address (default — matches GST requirements)", value: "true" },
                      { label: "Use Shipping Address for Ship-To section", value: "false" },
                    ]}
                    value={useBillingAsShipping}
                    onChange={setUseBillingAsShipping}
                    helpText="When set to Shipping Address, the buyer's delivery address is used as Ship To on the invoice."
                  />
                  <Button submit variant="primary">Save Business Details</Button>
                </FormLayout>
              </Form>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Email Settings */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Email Settings</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Auto-send invoices to customers after order events.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="save-email" />
                <FormLayout>
                  <Select
                    label="Auto-send Invoice"
                    name="autoEmailEnabled"
                    options={[
                      { label: "Disabled", value: "false" },
                      { label: "Enabled", value: "true" },
                    ]}
                    value={autoEmail}
                    onChange={setAutoEmail}
                  />
                  <Select
                    label="Send Trigger"
                    name="emailTrigger"
                    options={[
                      { label: "On Order Paid", value: "paid" },
                      { label: "On Order Fulfilled", value: "fulfilled" },
                    ]}
                    value={emailTrigger}
                    onChange={setEmailTrigger}
                    helpText="When should the invoice email be sent to the customer?"
                  />
                  <TextField
                    label="Email Subject"
                    name="emailSubject"
                    value={emailSubject}
                    onChange={setEmailSubject}
                    helpText="Use {invoice_number} as a placeholder."
                    autoComplete="off"
                  />
                  <TextField
                    label="Email Body"
                    name="emailBody"
                    value={emailBody}
                    onChange={setEmailBody}
                    multiline={4}
                    autoComplete="off"
                    helpText="Custom message to include in the email. Leave blank for default message."
                  />
                  <Button submit variant="primary">Save Email Settings</Button>
                </FormLayout>
              </Form>

              {/* Test Email */}
              <div style={{ marginTop: 16, borderTop: "1px solid #e1e3e5", paddingTop: 16 }}>
                <Form method="post">
                  <input type="hidden" name="intent" value="test-email" />
                  <FormLayout>
                    <TextField
                      label="Send Test Email"
                      name="testEmail"
                      type="email"
                      value={testEmailValue}
                      onChange={setTestEmailValue}
                      placeholder="Enter email address…"
                      autoComplete="email"
                      helpText="Send a test email to verify your email configuration."
                      connectedRight={
                        <Button submit variant="secondary">Send Test</Button>
                      }
                    />
                  </FormLayout>
                </Form>
              </div>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Shopify Snippet */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Shopify Notification Snippet</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Add this snippet to your Shopify order confirmation email template to include a direct PDF download link.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  Copy this Liquid snippet and paste it into your Shopify order notification email template
                  (Settings → Notifications → Order Confirmation in Shopify Admin).
                </Text>
                <div style={{ background: "#f4f4f4", borderRadius: 6, padding: "12px 16px", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`{% assign invoice_url = "` + (typeof window !== "undefined" ? window.location.origin : "") + `/app/invoice-download/" | append: order.id %}
<p style="margin: 16px 0;">
  <a href="{{ invoice_url }}" style="background:#1a73e8; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">
    Download GST Invoice
  </a>
</p>`}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const snippet = `{% assign invoice_url = "${typeof window !== "undefined" ? window.location.origin : ""}/app/invoice-download/" | append: order.id %}\n<p style="margin: 16px 0;">\n  <a href="{{ invoice_url }}" style="background:#1a73e8; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">\n    Download GST Invoice\n  </a>\n</p>`;
                    navigator.clipboard.writeText(snippet);
                  }}
                >
                  Copy Snippet
                </Button>
                <Banner tone="info">
                  After copying the snippet, go to Shopify Admin → Settings → Notifications → Order Confirmation and paste it in the email body.
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Packing Slip Snippet */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Packing Slip Snippet</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Add this to your Shopify shipping confirmation email to include a packing slip download link.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  Paste this snippet in Shopify Admin → Settings → Notifications → Shipping Confirmation.
                </Text>
                <div style={{ background: "#f4f4f4", borderRadius: 6, padding: "12px 16px", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`{% assign slip_url = "` + (typeof window !== "undefined" ? window.location.origin : "") + `/app/packing-slip-download/" | append: order.id %}
<p style="margin: 16px 0;">
  <a href="{{ slip_url }}" style="background:#2e7d32; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">
    Download Packing Slip
  </a>
</p>`}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const origin = typeof window !== "undefined" ? window.location.origin : "";
                    const snippet = `{% assign slip_url = "${origin}/app/packing-slip-download/" | append: order.id %}\n<p style="margin: 16px 0;">\n  <a href="{{ slip_url }}" style="background:#2e7d32; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">\n    Download Packing Slip\n  </a>\n</p>`;
                    navigator.clipboard.writeText(snippet);
                  }}
                >
                  Copy Snippet
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Credit Note Snippet */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Credit Note Snippet</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Add this to your Shopify refund notification email to include a credit note download link.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  Paste this snippet in Shopify Admin → Settings → Notifications → Refund Confirmation.
                </Text>
                <div style={{ background: "#f4f4f4", borderRadius: 6, padding: "12px 16px", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`{% assign cn_url = "` + (typeof window !== "undefined" ? window.location.origin : "") + `/app/credit-note-download/" | append: order.id %}
<p style="margin: 16px 0;">
  <a href="{{ cn_url }}" style="background:#c62828; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">
    Download Credit Note
  </a>
</p>`}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const origin = typeof window !== "undefined" ? window.location.origin : "";
                    const snippet = `{% assign cn_url = "${origin}/app/credit-note-download/" | append: order.id %}\n<p style="margin: 16px 0;">\n  <a href="{{ cn_url }}" style="background:#c62828; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none; font-weight:bold;">\n    Download Credit Note\n  </a>\n</p>`;
                    navigator.clipboard.writeText(snippet);
                  }}
                >
                  Copy Snippet
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Invoice Number & Formatting */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Invoice Numbering</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Configure how invoice numbers are generated. Financial year resets the counter each April.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="save-invoice-format" />
                <FormLayout>
                  <ChoiceList
                    title="Invoice number type"
                    choices={[
                      { label: "Custom (Prefix + Sequential Number)", value: "custom" },
                      { label: "Same as Shopify Order Number", value: "order_number" },
                    ]}
                    selected={invoiceNumberType}
                    onChange={setInvoiceNumberType}
                    name="invoiceNumberType"
                  />
                  {invoiceNumberType[0] === "custom" && (
                    <>
                      <FormLayout.Group>
                        <TextField
                          label="Invoice Prefix"
                          name="invoicePrefix"
                          value={invoicePrefix}
                          onChange={setInvoicePrefix}
                          helpText={`e.g. INV, BILL, ${currentFY}`}
                          autoComplete="off"
                        />
                        <TextField
                          label="Invoice Suffix (optional)"
                          name="invoiceSuffix"
                          value={invoiceSuffix}
                          onChange={setInvoiceSuffix}
                          helpText="e.g. /GST or leave blank"
                          autoComplete="off"
                        />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <TextField
                          label="Start Number (current FY)"
                          name="invoiceStartNumber"
                          value={invoiceStartNumber}
                          onChange={setInvoiceStartNumber}
                          type="number"
                          helpText="Counter resets each financial year"
                          autoComplete="off"
                        />
                        <Select
                          label="Financial Year Start Month"
                          name="financialYearStart"
                          options={[
                            { label: "April (Indian FY)", value: "4" },
                            { label: "January", value: "1" },
                            { label: "March", value: "3" },
                          ]}
                          value={financialYearStart}
                          onChange={setFinancialYearStart}
                        />
                      </FormLayout.Group>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Preview: <strong>{invoicePreview}</strong> (FY {currentFY})
                      </Text>
                    </>
                  )}
                  <Divider />
                  <FormLayout.Group>
                    <Select
                      label="Currency Display"
                      name="currencySymbol"
                      options={[
                        { label: "₹ (Rupee symbol)", value: "₹" },
                        { label: "Rs. (text)", value: "Rs." },
                        { label: "INR (code)", value: "INR" },
                      ]}
                      value={currencySymbol}
                      onChange={setCurrencySymbol}
                    />
                    <Select
                      label="Date Format"
                      name="dateFormat"
                      options={[
                        { label: "DD-MM-YYYY (15-01-2025)", value: "DD-MM-YYYY" },
                        { label: "DD/MM/YYYY (15/01/2025)", value: "DD/MM/YYYY" },
                        { label: "Jan 15, 2025", value: "MMM DD YYYY" },
                      ]}
                      value={dateFormat}
                      onChange={setDateFormat}
                    />
                  </FormLayout.Group>
                  <Button submit variant="primary">Save Invoice Format</Button>
                </FormLayout>
              </Form>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Tax Settings */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Tax Settings</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Control how GST is applied on orders, exports, and shipping.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="save-tax-settings" />
                <FormLayout>
                  <Select
                    label="Tax Products"
                    name="taxAllProducts"
                    options={[
                      { label: "Tax all products (default)", value: "true" },
                      { label: "Tax only Shopify-taxable products", value: "false" },
                    ]}
                    value={taxAllProducts[0]}
                    onChange={(v) => setTaxAllProducts([v])}
                    helpText="Use 'Shopify-taxable only' if some products are exempt."
                  />
                  <Select
                    label="International / Export Orders"
                    name="zeroTaxOnExports"
                    options={[
                      { label: "Zero GST on exports (default)", value: "true" },
                      { label: "Apply GST on export orders", value: "false" },
                    ]}
                    value={zeroTaxOnExports[0]}
                    onChange={(v) => setZeroTaxOnExports([v])}
                  />
                  <Select
                    label="Tax Split Method (IGST vs CGST+SGST)"
                    name="taxSplitMethod"
                    options={[
                      { label: "Use Shipping Address state", value: "shipping" },
                      { label: "Use Billing Address state", value: "billing" },
                    ]}
                    value={taxSplitMethod[0]}
                    onChange={(v) => setTaxSplitMethod([v])}
                    helpText="Compare seller state against this address to determine IGST or CGST+SGST."
                  />
                  <Divider />
                  <Select
                    label="Apply Default GST Rate"
                    name="useDefaultGstRate"
                    options={[
                      { label: "Enabled — apply default rate to products with no Shopify tax", value: "true" },
                      { label: "Disabled — treat products with no Shopify tax as 0% (Exempt)", value: "false" },
                    ]}
                    value={useDefaultGstRate}
                    onChange={setUseDefaultGstRate}
                    helpText="When disabled, products that have no GST configured in Shopify will appear as 0% (exempt) on the invoice instead of using the default rate below."
                  />
                  <Select
                    label="Default Product GST Rate"
                    name="defaultGstRate"
                    options={[
                      { label: "0% (Exempt)", value: "0" },
                      { label: "0.25%", value: "0.25" },
                      { label: "3%", value: "3" },
                      { label: "5%", value: "5" },
                      { label: "12%", value: "12" },
                      { label: "18% (most common)", value: "18" },
                      { label: "28%", value: "28" },
                    ]}
                    value={defaultGstRate}
                    onChange={setDefaultGstRate}
                    helpText="Used when 'Apply Default GST Rate' is enabled and Shopify orders have no tax lines."
                  />
                  <Divider />
                  <Select
                    label="Shipping GST"
                    name="shippingGstEnabled"
                    options={[
                      { label: "Disabled (no GST on shipping)", value: "false" },
                      { label: "Enabled (add GST on shipping charge)", value: "true" },
                    ]}
                    value={shippingGstEnabled[0]}
                    onChange={(v) => setShippingGstEnabled([v])}
                  />
                  {shippingGstEnabled[0] === "true" && (
                    <FormLayout.Group>
                      <Select
                        label="Shipping GST Rate"
                        name="shippingGstRate"
                        options={[
                          { label: "5%", value: "5" },
                          { label: "12%", value: "12" },
                          { label: "18% (default)", value: "18" },
                          { label: "28%", value: "28" },
                        ]}
                        value={shippingGstRate}
                        onChange={setShippingGstRate}
                      />
                      <TextField
                        label="Shipping HSN Code"
                        name="shippingHsnCode"
                        value={shippingHsnCode}
                        onChange={setShippingHsnCode}
                        helpText="Default: 996812 (courier services)"
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                  )}
                  <Select
                    label="Compare-at Price as Rate"
                    name="compareAtPrice"
                    options={[
                      { label: "Disabled — use actual selling price (default)", value: "false" },
                      { label: "Enabled — use compare-at price as MRP on invoice", value: "true" },
                    ]}
                    value={compareAtPrice[0]}
                    onChange={(v) => setCompareAtPrice([v])}
                    helpText="When enabled, the product's original (compare-at) price is shown as MRP and the discount is displayed separately."
                  />
                  <Select
                    label="Show Returned Line Items"
                    name="showReturnedItems"
                    options={[
                      { label: "Disabled — hide returned items (default)", value: "false" },
                      { label: "Enabled — show returned items with negative qty", value: "true" },
                    ]}
                    value={showReturnedItems[0]}
                    onChange={(v) => setShowReturnedItems([v])}
                    helpText="When enabled, refunded/returned products appear on the invoice with negative quantities."
                  />
                  <Button submit variant="primary">Save Tax Settings</Button>
                </FormLayout>
              </Form>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Logo & Signature */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Logo &amp; Signature</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Upload your business logo and authorized signature. Both will appear on your invoices.
              </Text>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">

                {/* Business Logo */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Business Logo</Text>

                  {/* Warn if old-format path is stored — user must re-upload */}
                  {logoPreview && !logoPreview.startsWith("data:") && !logoPreview.startsWith("http") && (
                    <Banner tone="warning">
                      Your logo needs to be re-uploaded. Click "Remove logo" then upload the correct logo image.
                    </Banner>
                  )}

                  {/* Preview */}
                  {logoPreview && (
                    <div style={{
                      width: 88, height: 88, border: "1px solid #e1e3e5", borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", background: "#fafafa",
                    }}>
                      <img src={logoPreview} alt="Business logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    </div>
                  )}

                  {/* Upload + Delete buttons */}
                  <InlineStack gap="200" blockAlign="center">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setLogoPreview(URL.createObjectURL(file));
                        uploadViaBase64(file, "logo", logoFetcher);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      loading={logoFetcher.state !== "idle"}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      Upload logo
                    </Button>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-logo" />
                      <Button
                        submit
                        icon={DeleteIcon}
                        tone="critical"
                        variant="secondary"
                        disabled={!logoPreview}
                        accessibilityLabel="Remove logo"
                      />
                    </Form>
                  </InlineStack>

                  {/* Instructions */}
                  <List type="bullet">
                    <List.Item>Your logo file must be smaller than 2 MB and in format: .jpg or .png.</List.Item>
                    <List.Item>We recommend that your logo should have a transparent background.</List.Item>
                  </List>
                </BlockStack>

                <Divider />

                {/* Authorized Signature */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Authorized Signature</Text>

                  {/* Warn if old-format path is stored — user must re-upload */}
                  {sigPreview && !sigPreview.startsWith("data:") && !sigPreview.startsWith("http") && (
                    <Banner tone="warning">
                      Your signature needs to be re-uploaded. Click "Remove signature" then upload the correct signature image.
                    </Banner>
                  )}

                  {/* Preview */}
                  {sigPreview && (
                    <div style={{
                      width: 88, height: 88, border: "1px solid #e1e3e5", borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", background: "#fafafa",
                    }}>
                      <img src={sigPreview} alt="Authorized signature" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    </div>
                  )}

                  {/* Upload + Delete buttons */}
                  <InlineStack gap="200" blockAlign="center">
                    <input
                      ref={sigInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setSigPreview(URL.createObjectURL(file));
                        uploadViaBase64(file, "signature", sigFetcher);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      loading={sigFetcher.state !== "idle"}
                      onClick={() => sigInputRef.current?.click()}
                    >
                      Upload signature
                    </Button>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-signature" />
                      <Button
                        submit
                        icon={DeleteIcon}
                        tone="critical"
                        variant="secondary"
                        disabled={!sigPreview}
                        accessibilityLabel="Remove signature"
                      />
                    </Form>
                  </InlineStack>

                  {/* Instructions */}
                  <List type="bullet">
                    <List.Item>Your signature file must be smaller than 2 MB and in format: .jpg or .png.</List.Item>
                    <List.Item>We recommend using a PNG with a transparent background.</List.Item>
                  </List>
                </BlockStack>

              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Custom Invoice Fields */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Custom Invoice Fields</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Add extra fields to your invoices — PO Number, LR Number, E-Way Bill No., Vehicle No., etc.
                    These appear on the printed PDF and can be filled in per invoice.
                  </Text>
                </BlockStack>

                {customFieldsFetcher.data?.success && (
                  <Banner tone="success">{customFieldsFetcher.data.success}</Banner>
                )}
                {customFieldsFetcher.data?.error && (
                  <Banner tone="critical">{customFieldsFetcher.data.error}</Banner>
                )}

                <BlockStack gap="200">
                  {customFieldDefs.length === 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">No custom fields defined yet. Click "Add Field" to get started.</Text>
                  )}
                  {customFieldDefs.map((field, idx) => (
                    <InlineStack key={idx} gap="300" blockAlign="center" wrap={false}>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Label"
                          labelHidden
                          placeholder="e.g. PO Number"
                          value={field.label}
                          onChange={(v) => {
                            const updated = [...customFieldDefs];
                            updated[idx] = { ...updated[idx], label: v };
                            setCustomFieldDefs(updated);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ width: 130 }}>
                        <Select
                          label="Type"
                          labelHidden
                          options={[
                            { label: "Text", value: "text" },
                            { label: "Date", value: "date" },
                            { label: "Number", value: "number" },
                          ]}
                          value={field.type}
                          onChange={(v) => {
                            const updated = [...customFieldDefs];
                            updated[idx] = { ...updated[idx], type: v as CustomFieldDef["type"] };
                            setCustomFieldDefs(updated);
                          }}
                        />
                      </div>
                      <Button
                        tone="critical"
                        variant="plain"
                        onClick={() => setCustomFieldDefs(customFieldDefs.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>

                <InlineStack gap="300">
                  {customFieldDefs.length < 6 && (
                    <Button
                      onClick={() => setCustomFieldDefs([
                        ...customFieldDefs,
                        { key: `field_${Date.now()}`, label: "", type: "text" },
                      ])}
                    >
                      + Add Field
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    loading={customFieldsFetcher.state !== "idle"}
                    onClick={() => {
                      const valid = customFieldDefs
                        .filter(f => f.label.trim())
                        .map(f => ({
                          key: f.key.startsWith("field_") ? f.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : f.key,
                          label: f.label.trim(),
                          type: f.type,
                        }));
                      const fd = new FormData();
                      fd.append("intent", "save-custom-fields");
                      fd.append("customFields", JSON.stringify(valid));
                      customFieldsFetcher.submit(fd, { method: "post" });
                    }}
                  >
                    Save Custom Fields
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* E-Invoice (NIC IRP) Settings */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">E-Invoice (NIC IRP)</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Configure your NIC Invoice Registration Portal credentials to generate IRN for B2B invoices.
                    Get credentials from{" "}
                    <a href="https://einvoice1-uat.nic.in" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                      einvoice1-uat.nic.in
                    </a>{" "}
                    (sandbox) or{" "}
                    <a href="https://einvoice1.nic.in" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                      einvoice1.nic.in
                    </a>{" "}
                    (production).
                  </Text>
                </BlockStack>

                {einvoiceFetcher.data?.success && (
                  <Banner tone="success">{einvoiceFetcher.data.success}</Banner>
                )}
                {einvoiceFetcher.data?.error && (
                  <Banner tone="critical">{einvoiceFetcher.data.error}</Banner>
                )}

                <ChoiceList
                  title="E-Invoice Generation"
                  choices={[
                    { label: "Enable E-Invoice (IRN) generation", value: "true" },
                  ]}
                  selected={eInvoiceEnabled ? ["true"] : []}
                  onChange={(v) => setEInvoiceEnabled(v.includes("true"))}
                />

                <ChoiceList
                  title="API Environment"
                  choices={[
                    { label: "Sandbox / UAT (for testing)", value: "sandbox" },
                    { label: "Production (live)",           value: "prod"    },
                  ]}
                  selected={[eInvoiceSandbox ? "sandbox" : "prod"]}
                  onChange={(v) => setEInvoiceSandbox(v[0] === "sandbox")}
                />

                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Client ID"
                      value={eInvoiceClientId ?? ""}
                      onChange={setEInvoiceClientId}
                      autoComplete="off"
                      placeholder="From NIC portal"
                    />
                    <TextField
                      label="Client Secret"
                      value={eInvoiceClientSecret}
                      onChange={setEInvoiceClientSecret}
                      autoComplete="off"
                      type="password"
                      placeholder={shop?.settings?.eInvoiceClientSecret ? "••••••• (saved)" : "Enter client secret"}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="API Username"
                      value={eInvoiceApiUser ?? ""}
                      onChange={setEInvoiceApiUser}
                      autoComplete="off"
                      placeholder="Your NIC portal username"
                    />
                    <TextField
                      label="API Password"
                      value={eInvoiceApiPass}
                      onChange={setEInvoiceApiPass}
                      autoComplete="off"
                      type="password"
                      placeholder={shop?.settings?.eInvoiceApiPass ? "••••••• (saved)" : "Enter password"}
                    />
                  </FormLayout.Group>
                </FormLayout>

                <InlineStack>
                  <Button
                    variant="primary"
                    loading={einvoiceFetcher.state !== "idle"}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("intent",               "save-einvoice");
                      fd.append("eInvoiceEnabled",      String(eInvoiceEnabled));
                      fd.append("eInvoiceSandbox",      String(eInvoiceSandbox));
                      fd.append("eInvoiceClientId",     eInvoiceClientId ?? "");
                      fd.append("eInvoiceClientSecret", eInvoiceClientSecret);
                      fd.append("eInvoiceApiUser",      eInvoiceApiUser ?? "");
                      fd.append("eInvoiceApiPass",      eInvoiceApiPass);
                      einvoiceFetcher.submit(fd, { method: "post" });
                    }}
                  >
                    Save E-Invoice Settings
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
    </Frame>
  );
}
