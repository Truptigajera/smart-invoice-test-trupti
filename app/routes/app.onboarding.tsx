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
import { validateGstin, getStateCodeFromGstin, getIndianStateCode, STATE_CODES } from "~/lib/gst";
import { getOrCreateShop } from "~/lib/shop.server";

const STORE_INFO_QUERY = `#graphql
  query onboardingStoreInfo {
    shop {
      name
      billingAddress { address1 address2 city zip province provinceCode phone countryCodeV2 }
    }
  }
`;

// react-pdf can only embed PNG/JPEG images — SVG/WebP logos would silently vanish from invoices
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop);

  if (shop.onboardingDone) {
    const url = new URL(request.url);
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  // Prefill from the Shopify store address so the merchant mostly just confirms.
  // Values already saved in our DB (e.g. after a page refresh) take priority.
  let store: {
    name?: string;
    billingAddress?: {
      address1?: string; address2?: string; city?: string; zip?: string;
      province?: string; provinceCode?: string; phone?: string; countryCodeV2?: string;
    };
  } = {};
  try {
    const res = await admin.graphql(STORE_INFO_QUERY);
    store = (await res.json()).data?.shop ?? {};
  } catch {
    // Prefill is a convenience only — the merchant can still type everything
  }
  const addr = store.billingAddress ?? {};
  const storeStateCode = addr.countryCodeV2 === "IN"
    ? getIndianStateCode(addr.provinceCode ?? "", addr.province ?? "")
    : "";

  const settings = await prisma.shopSettings.findUnique({ where: { shopId: shop.id } });

  return json({
    prefill: {
      gstin: shop.gstin ?? "",
      businessName: shop.businessName ?? store.name ?? "",
      address: shop.address ?? [addr.address1, addr.address2].filter(Boolean).join(", "),
      city: shop.city ?? addr.city ?? "",
      stateCode: shop.stateCode || storeStateCode,
      pincode: shop.pincode ?? addr.zip ?? "",
      phone: shop.phone ?? addr.phone ?? "",
      invoicePrefix: shop.invoicePrefix || "INV",
      autoEmail: settings?.autoEmailEnabled ? "on" : "",
    },
    gstinLookupEnabled: Boolean(process.env.GSTIN_API_URL),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");

  let formData: FormData;
  if (isMultipart) {
    try {
      formData = await unstable_parseMultipartFormData(
        request,
        unstable_createMemoryUploadHandler({ maxPartSize: MAX_IMAGE_BYTES })
      );
    } catch {
      // Thrown when a file exceeds maxPartSize — show a message instead of crashing the page
      return json({ error: "Logo and signature must each be smaller than 2 MB.", step: 3 });
    }
  } else {
    formData = await request.formData();
  }

  const step = parseInt(formData.get("step") as string || "1", 10);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  if (step === 1) {
    const field = (name: string) => ((formData.get(name) as string) || "").trim();
    const gstin = field("gstin").toUpperCase();
    const businessName = field("businessName");
    const pincode = field("pincode");

    if (gstin && !validateGstin(gstin)) {
      return json({ error: "Invalid GSTIN format. Example: 22AAAAA0000A1Z5", step: 1 });
    }
    if (!businessName) {
      return json({ error: "Business / Trade Name is required — it is printed on every invoice.", step: 1 });
    }
    // The seller's state decides CGST+SGST (same state) vs IGST (other state) on every invoice,
    // so it is required even without a GSTIN. With a GSTIN, the first 2 digits are authoritative.
    const stateCode = gstin ? getStateCodeFromGstin(gstin) : field("stateCode");
    if (!STATE_CODES[stateCode]) {
      return json({ error: "Please select your business state — it decides CGST/SGST vs IGST on invoices.", step: 1 });
    }
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return json({ error: "Pincode must be 6 digits.", step: 1 });
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        gstin: gstin || null,
        businessName,
        address: field("address") || null,
        city: field("city") || null,
        stateCode,
        state: STATE_CODES[stateCode],
        pincode: pincode || null,
        phone: field("phone") || null,
      },
    });
    return json({ step: 2 });
  }

  if (step === 2) {
    // GST rule: the full invoice number may be at most 16 characters, using only
    // letters, digits, "-" and "/". Prefix + "-" + 4-digit counter must fit in that.
    const invoicePrefix = ((formData.get("invoicePrefix") as string) || "").trim().toUpperCase() || "INV";
    if (!/^[A-Z0-9/-]{1,10}$/.test(invoicePrefix)) {
      return json({ error: "Invoice prefix can have up to 10 letters, numbers, \"-\" or \"/\" (no spaces).", step: 2 });
    }

    await prisma.shop.update({ where: { id: shop.id }, data: { invoicePrefix } });
    // Template is not asked here — merchants pick it later on the Templates page, where they
    // can see a preview. Only set the default when settings are created for the first time.
    await prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, autoEmailEnabled: formData.get("autoEmail") === "on" },
      update: { autoEmailEnabled: formData.get("autoEmail") === "on" },
    });
    return json({ step: 3 });
  }

  if (step === 3) {
    // Logo / signature are optional — stored as base64 data URLs in the DB (no filesystem dependency)
    const logoFile = formData.get("logo") as File | null;
    const sigFile  = formData.get("signature") as File | null;

    for (const f of [logoFile, sigFile]) {
      if (f && f.size > 0 && !ALLOWED_IMAGE_TYPES.includes(f.type)) {
        return json({ error: "Please upload PNG or JPG images only (SVG/WebP can't be printed on the PDF).", step: 3 });
      }
    }

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

    await prisma.shop.update({ where: { id: shop.id }, data: { ...updates, onboardingDone: true } });
    const url = new URL(request.url);
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({ error: "Unknown step" });
};

const STEPS = ["Business details", "Invoice setup", "Logo & signature"];

export default function OnboardingPage() {
  const { prefill, gstinLookupEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // The server moves the merchant forward (or keeps them on a step with an error);
  // "Back" is client-only, so the step lives in state and follows each action result.
  const [currentStep, setCurrentStep] = useState(1);
  useEffect(() => {
    if (actionData && "step" in actionData) setCurrentStep(actionData.step as number);
  }, [actionData]);
  const progress = (currentStep / STEPS.length) * 100;

  const [gstin, setGstin]               = useState(prefill.gstin);
  const [businessName, setBusinessName] = useState(prefill.businessName);
  const [address, setAddress]           = useState(prefill.address);
  const [city, setCity]                 = useState(prefill.city);
  const [stateCode, setStateCode]       = useState(prefill.stateCode);
  const [pincode, setPincode]           = useState(prefill.pincode);
  const [phone, setPhone]               = useState(prefill.phone);
  const [invoicePrefix, setInvoicePrefix] = useState(prefill.invoicePrefix);
  const [autoEmail, setAutoEmail]         = useState(prefill.autoEmail);
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
  // With a GSTIN the state is fixed by its first 2 digits; without one the merchant picks it
  const gstinStateCode = detectedState ? gstin.substring(0, 2) : "";
  const stateOptions = [
    { label: "Select state", value: "" },
    ...Object.entries(STATE_CODES)
      .map(([code, name]) => ({ label: `${name} (${code})`, value: code }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  // Un-pick a file so it isn't uploaded when the form is submitted
  const clearUpload = (
    ref: React.RefObject<HTMLInputElement>,
    setPreview: (v: string | null) => void
  ) => {
    if (ref.current) ref.current.value = "";
    setPreview(null);
  };

  const previewFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (file) setter(URL.createObjectURL(file));
  };

  const gstinInvalid = gstin.length === 15 && !validateGstin(gstin);
  const prefixPreview = `${(invoicePrefix || "INV").toUpperCase()}-0001`;

  return (
    <Page narrowWidth>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl" alignment="center">Welcome! Let's set up your GST invoices</Text>
          <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
            3 quick steps — takes about a minute
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
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Step 1: Your business details</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    These are printed on every invoice. We've filled them from your Shopify store — just check and continue.
                  </Text>
                </BlockStack>
                <FormLayout>
                  <TextField
                    label="GSTIN"
                    name="gstin"
                    value={gstin}
                    onChange={(v) => setGstin(v.toUpperCase().slice(0, 15))}
                    placeholder="22AAAAA0000A1Z5"
                    helpText="Your 15-digit GSTIN. Leave blank if you are not GST registered."
                    error={gstinInvalid ? "This doesn't look like a valid GSTIN — please check it." : undefined}
                    maxLength={15}
                    autoComplete="off"
                    connectedRight={
                      // Only useful when a GST registry API is configured; without it the
                      // button could only repeat the state that's already detected below.
                      gstinLookupEnabled ? (
                        <Button
                          onClick={handleFetchGstin}
                          disabled={gstin.length !== 15 || gstinInvalid || isFetchingGstin}
                          loading={isFetchingGstin}
                          variant="secondary"
                        >
                          Fetch Details
                        </Button>
                      ) : undefined
                    }
                  />
                  {gstinFetcher.data?.fromApi && (
                    <Banner tone="success">Business details filled from the GST registry — please check them.</Banner>
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
                    requiredIndicator
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
                    <Select
                      label="State"
                      name={gstinStateCode ? undefined : "stateCode"}
                      options={stateOptions}
                      value={gstinStateCode || stateCode}
                      onChange={setStateCode}
                      disabled={!!gstinStateCode}
                      requiredIndicator
                      helpText={gstinStateCode ? "Detected from GSTIN" : "Decides CGST+SGST vs IGST"}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField label="Pincode" name="pincode" value={pincode} onChange={(v) => setPincode(v.replace(/\D/g, "").slice(0, 6))} placeholder="400001" inputMode="numeric" autoComplete="off" />
                    <TextField label="Phone"   name="phone"   value={phone}   onChange={setPhone}   placeholder="+91 9876543210"   autoComplete="off" />
                  </FormLayout.Group>
                  <Button submit variant="primary" loading={isSubmitting} fullWidth>Continue →</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* Step 2: Invoice setup */}
        {currentStep === 2 && (
          <Card>
            <Form method="post">
              <input type="hidden" name="step" value="2" />
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 2: Invoice setup</Text>
                <FormLayout>
                  <TextField
                    label="Invoice number prefix"
                    name="invoicePrefix"
                    value={invoicePrefix}
                    onChange={(v) => setInvoicePrefix(v.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 10))}
                    helpText={`Your first invoice will be ${prefixPreview}. Letters, numbers, "-" or "/" only.`}
                    autoComplete="off"
                  />
                  <Select
                    label="Email invoices to customers automatically?"
                    name="autoEmail"
                    options={[
                      { label: "No — I'll send invoices myself", value: "" },
                      { label: "Yes — email the invoice when an order is fulfilled", value: "on" },
                    ]}
                    value={autoEmail}
                    onChange={setAutoEmail}
                    helpText="You can change this anytime in Settings."
                  />
                </FormLayout>
                <InlineStack align="space-between" blockAlign="center">
                  <Button onClick={() => setCurrentStep(1)} disabled={isSubmitting}>← Back</Button>
                  <Button submit variant="primary" loading={isSubmitting}>Continue →</Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* Step 3: Logo & signature (optional) */}
        {currentStep === 3 && (
          <Card>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="step" value="3" />
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Step 3: Logo &amp; signature (optional)</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Shown on your invoices. You can skip this and add them later from Settings.
                  </Text>
                </BlockStack>

                {[
                  { label: "Business logo", name: "logo", ref: logoRef, preview: logoPreview, setPreview: setLogoPreview, hint: "PNG or JPG, max 2 MB" },
                  { label: "Authorized signature", name: "signature", ref: sigRef, preview: sigPreview, setPreview: setSigPreview, hint: "PNG with transparent background works best, max 2 MB" },
                ].map((u) => (
                  <BlockStack key={u.name} gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">{u.label}</Text>
                    <InlineStack gap="300" blockAlign="center">
                      {u.preview ? (
                        <Thumbnail source={u.preview} alt={`${u.label} preview`} size="large" />
                      ) : (
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200" borderWidth="025" borderColor="border">
                          <Text as="p" tone="subdued">Not added</Text>
                        </Box>
                      )}
                      <BlockStack gap="100">
                        <input
                          ref={u.ref}
                          type="file"
                          name={u.name}
                          accept="image/png,image/jpeg"
                          style={{ display: "none" }}
                          onChange={(e) => previewFile(e, u.setPreview)}
                        />
                        <InlineStack gap="200" blockAlign="center">
                          <Button onClick={() => u.ref.current?.click()}>
                            {u.preview ? "Change" : "Upload"}
                          </Button>
                          {u.preview && (
                            <Button variant="plain" tone="critical" onClick={() => clearUpload(u.ref, u.setPreview)}>
                              Remove
                            </Button>
                          )}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">{u.hint}</Text>
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                ))}

                <InlineStack align="space-between" blockAlign="center">
                  <Button
                    onClick={() => {
                      // Leaving this step unmounts the file inputs, so drop previews that would no longer upload
                      setLogoPreview(null);
                      setSigPreview(null);
                      setCurrentStep(2);
                    }}
                    disabled={isSubmitting}
                  >
                    ← Back
                  </Button>
                  <InlineStack gap="300" blockAlign="center">
                    {!logoPreview && !sigPreview && (
                      <Button submit variant="plain" loading={isSubmitting}>Skip for now</Button>
                    )}
                    <Button submit variant="primary" loading={isSubmitting}>Finish setup</Button>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        )}

      </BlockStack>
    </Page>
  );
}
