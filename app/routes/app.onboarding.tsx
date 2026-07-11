import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  json, redirect,
  unstable_parseMultipartFormData, unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useFetcher } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, TextField, Button,
  Select, Banner, ProgressBar, FormLayout, Thumbnail, Box,
} from "@shopify/polaris";
import { useState, useRef, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { validateGstin, getStateCodeFromGstin, STATE_CODES } from "~/lib/gst";
import { TEMPLATES_META } from "~/components/invoice-templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { shopDomain: session.shop } });
  }

  if (shop.onboardingDone) {
    const url = new URL(request.url);
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({ step: 1, shopDomain: session.shop });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");

  let formData: FormData;
  if (isMultipart) {
    formData = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: 2 * 1024 * 1024 })
    );
  } else {
    formData = await request.formData();
  }

  const step = parseInt(formData.get("step") as string || "1", 10);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  if (step === 1) {
    const gstin = (formData.get("gstin") as string || "").toUpperCase().trim();
    if (gstin && !validateGstin(gstin)) {
      return json({ error: "Invalid GSTIN format. Example: 22AAAAA0000A1Z5", step: 1 });
    }
    const stateCode = gstin ? getStateCodeFromGstin(gstin) : "";
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        gstin: gstin || null,
        businessName: formData.get("businessName") as string || null,
        address: formData.get("address") as string || null,
        city: formData.get("city") as string || null,
        stateCode,
        state: STATE_CODES[stateCode] || null,
        pincode: formData.get("pincode") as string || null,
        phone: formData.get("phone") as string || null,
      },
    });
    return json({ step: 2 });
  }

  if (step === 2) {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { invoicePrefix: formData.get("invoicePrefix") as string || "INV" },
    });
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        templateId: formData.get("templateId") as string || "template-1",
        autoEmailEnabled: formData.get("autoEmail") === "on",
      },
      update: {
        templateId: formData.get("templateId") as string || "template-1",
        autoEmailEnabled: formData.get("autoEmail") === "on",
      },
    });
    return json({ step: 3 });
  }

  if (step === 3) {
    // Handle logo / signature upload — store as base64 data URL in DB (no filesystem dependency)
    const logoFile = formData.get("logo") as File | null;
    const sigFile  = formData.get("signature") as File | null;

    const updates: { logoUrl?: string; signatureUrl?: string } = {};

    if (logoFile && logoFile.size > 0) {
      const buffer = await logoFile.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mime = logoFile.type || "image/png";
      updates.logoUrl = `data:${mime};base64,${base64}`;
    }
    if (sigFile && sigFile.size > 0) {
      const buffer = await sigFile.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mime = sigFile.type || "image/png";
      updates.signatureUrl = `data:${mime};base64,${base64}`;
    }

    if (Object.keys(updates).length) {
      await prisma.shop.update({ where: { id: shop.id }, data: updates });
    }

    await prisma.shop.update({ where: { id: shop.id }, data: { onboardingDone: true } });
    const url = new URL(request.url);
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({ error: "Unknown step" });
};

const STEPS = ["Business Info", "Invoice Setup", "Logo & Signature"];

export default function OnboardingPage() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const currentStep: number = actionData && "step" in actionData ? (actionData.step as number) : 1;
  const progress = ((currentStep - 1) / STEPS.length) * 100;

  const [gstin, setGstin]               = useState("");
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress]           = useState("");
  const [city, setCity]                 = useState("");
  const [pincode, setPincode]           = useState("");
  const [phone, setPhone]               = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("INV");
  const [templateId, setTemplateId]       = useState("template-1");
  const [autoEmail, setAutoEmail]         = useState("");
  const [logoPreview,  setLogoPreview]   = useState<string | null>(null);
  const [sigPreview,   setSigPreview]    = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef  = useRef<HTMLInputElement>(null);

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

  const detectedState = gstin.length >= 2 ? (STATE_CODES[gstin.substring(0, 2)] || "") : "";

  const previewFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (file) setter(URL.createObjectURL(file));
  };

  const templateOptions = TEMPLATES_META.map((t) => ({
    label: `Template ${t.id.split("-")[1]} — ${t.name}`,
    value: t.id,
  }));

  return (
    <Page narrowWidth>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl" alignment="center">Welcome to GST Invoice Pro</Text>
          <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
            Set up your account in 3 quick steps
          </Text>
        </BlockStack>

        {/* Progress */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              {STEPS.map((s, i) => (
                <Text
                  key={s}
                  as="span"
                  variant="bodySm"
                  tone={i + 1 < currentStep ? "success" : i + 1 === currentStep ? undefined : "subdued"}
                  fontWeight={i + 1 === currentStep ? "semibold" : undefined}
                >
                  {i + 1}. {s}
                </Text>
              ))}
            </InlineStack>
            <ProgressBar progress={progress} size="small" tone="primary" />
          </BlockStack>
        </Card>

        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error as string}</Banner>
        )}

        {/* Step 1: Business Info */}
        {currentStep === 1 && (
          <Card>
            <Form method="post">
              <input type="hidden" name="step" value="1" />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 1: Business Information</Text>
                <FormLayout>
                  <InlineStack gap="200" blockAlign="end">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="GSTIN"
                        name="gstin"
                        value={gstin}
                        onChange={(v) => setGstin(v.toUpperCase().slice(0, 15))}
                        placeholder="22AAAAA0000A1Z5"
                        helpText="Your 15-digit GSTIN. Leave blank if you don't have one."
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
                    </div>
                  </InlineStack>
                  {detectedState && (
                    <Banner tone="info">
                      State detected: <strong>{detectedState}</strong>
                      {gstinFetcher.data?.fromApi && " · Business details auto-filled from GST registry"}
                      {gstinFetcher.data && !gstinFetcher.data.fromApi && gstinFetcher.data.stateCode && " · Enter business name manually"}
                    </Banner>
                  )}
                  {gstinFetcher.data?.error && (
                    <Banner tone="critical">{gstinFetcher.data.error}</Banner>
                  )}
                  <TextField
                    label="Business / Trade Name"
                    name="businessName"
                    value={businessName}
                    onChange={setBusinessName}
                    placeholder="Your Company Pvt. Ltd."
                    autoComplete="off"
                  />
                  <TextField
                    label="Address"
                    name="address"
                    value={address}
                    onChange={setAddress}
                    placeholder="Shop No. 1, Main Street"
                    multiline={2}
                    autoComplete="off"
                  />
                  <FormLayout.Group>
                    <TextField label="City"    name="city"    value={city}    onChange={setCity}    placeholder="Mumbai"           autoComplete="off" />
                    <TextField label="Pincode" name="pincode" value={pincode} onChange={setPincode} placeholder="400001"           autoComplete="off" />
                    <TextField label="Phone"   name="phone"   value={phone}   onChange={setPhone}   placeholder="+91 9876543210"   autoComplete="off" />
                  </FormLayout.Group>
                  <Button submit variant="primary" loading={isSubmitting} fullWidth>Continue →</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* Step 2: Invoice Setup */}
        {currentStep === 2 && (
          <Card>
            <Form method="post">
              <input type="hidden" name="step" value="2" />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 2: Invoice Setup</Text>
                <FormLayout>
                  <TextField
                    label="Invoice Number Prefix"
                    name="invoicePrefix"
                    value={invoicePrefix}
                    onChange={setInvoicePrefix}
                    helpText={`Invoices will be: ${invoicePrefix}-0001, ${invoicePrefix}-0002...`}
                    autoComplete="off"
                  />
                  <Select
                    label="Default Invoice Template"
                    name="templateId"
                    options={templateOptions}
                    value={templateId}
                    onChange={setTemplateId}
                    helpText="You can change this anytime from the Templates page."
                  />
                  <Select
                    label="Auto-send Invoice Email"
                    name="autoEmail"
                    options={[
                      { label: "Yes — Send automatically on order fulfillment", value: "on" },
                      { label: "No — I will send manually", value: "" },
                    ]}
                    value={autoEmail}
                    onChange={setAutoEmail}
                  />
                  <Button submit variant="primary" loading={isSubmitting} fullWidth>Continue →</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* Step 3: Logo & Signature */}
        {currentStep === 3 && (
          <Card>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="step" value="3" />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 3: Logo &amp; Signature (Optional)</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Upload your business logo and authorized signature to appear on invoices.
                  You can skip this and upload later from Settings.
                </Text>

                {/* Logo upload */}
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Business Logo</Text>
                  <InlineStack gap="300" blockAlign="center">
                    {logoPreview ? (
                      <Thumbnail source={logoPreview} alt="Logo preview" size="large" />
                    ) : (
                      <Box
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor="border"
                      >
                        <Text as="p" tone="subdued">No logo selected</Text>
                      </Box>
                    )}
                    <BlockStack gap="200">
                      <input
                        ref={logoRef}
                        type="file"
                        name="logo"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => previewFile(e, setLogoPreview)}
                      />
                      <Button onClick={() => logoRef.current?.click()}>
                        {logoPreview ? "Change Logo" : "Upload Logo"}
                      </Button>
                      <Text as="p" variant="bodySm" tone="subdued">PNG, JPG, SVG — max 2MB</Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>

                {/* Signature upload */}
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Authorized Signature</Text>
                  <InlineStack gap="300" blockAlign="center">
                    {sigPreview ? (
                      <Thumbnail source={sigPreview} alt="Signature preview" size="large" />
                    ) : (
                      <Box
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor="border"
                      >
                        <Text as="p" tone="subdued">No signature selected</Text>
                      </Box>
                    )}
                    <BlockStack gap="200">
                      <input
                        ref={sigRef}
                        type="file"
                        name="signature"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => previewFile(e, setSigPreview)}
                      />
                      <Button onClick={() => sigRef.current?.click()}>
                        {sigPreview ? "Change Signature" : "Upload Signature"}
                      </Button>
                      <Text as="p" variant="bodySm" tone="subdued">PNG with transparent background recommended</Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>

                <InlineStack gap="300">
                  <Button submit variant="primary" loading={isSubmitting}>
                    Finish Setup →
                  </Button>
                  <Button submit loading={isSubmitting} variant="plain">
                    Skip for now
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        )}

      </BlockStack>
    </Page>
  );
}
