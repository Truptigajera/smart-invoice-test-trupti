import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  FormLayout,
  Select,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SmtpSettings {
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
}

type ActionData =
  | { success: string; error?: never }
  | { error: string; success?: never };

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });

  const settings: SmtpSettings = {
    smtpEnabled: shop?.settings?.smtpEnabled ?? false,
    smtpHost: shop?.settings?.smtpHost ?? null,
    smtpPort: shop?.settings?.smtpPort ?? null,
    smtpUser: shop?.settings?.smtpUser ?? null,
    smtpPass: shop?.settings?.smtpPass ?? null,
    smtpFrom: shop?.settings?.smtpFrom ?? null,
  };

  return json({ settings });
};

// ─── Action ─────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { settings: true },
  });

  if (!shopRecord) {
    return json<ActionData>({ error: "Shop not found" }, { status: 404 });
  }

  // ── save-smtp ─────────────────────────────────────────────────────────────
  if (intent === "save-smtp") {
    const smtpEnabled = formData.get("smtpEnabled") === "true";
    const smtpHost = (formData.get("smtpHost") as string | null) || null;
    const smtpPortRaw = formData.get("smtpPort") as string | null;
    const smtpPort = smtpPortRaw ? parseInt(smtpPortRaw, 10) : null;
    const smtpUser = (formData.get("smtpUser") as string | null) || null;
    const smtpFrom = (formData.get("smtpFrom") as string | null) || null;

    // Only update password if a new value was provided — never clear an existing one
    const smtpPassRaw = (formData.get("smtpPass") as string | null) ?? "";
    const smtpPassUpdate =
      smtpPassRaw.trim() !== ""
        ? { smtpPass: smtpPassRaw }
        : {};

    await prisma.shopSettings.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        smtpEnabled,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
        ...(smtpPassRaw.trim() !== "" ? { smtpPass: smtpPassRaw } : {}),
      },
      update: {
        smtpEnabled,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
        ...smtpPassUpdate,
      },
    });

    return json<ActionData>({ success: "SMTP settings saved!" });
  }

  // ── test-smtp ─────────────────────────────────────────────────────────────
  if (intent === "test-smtp") {
    const smtpHost = (formData.get("smtpHost") as string | null) || "";
    const smtpPortRaw = formData.get("smtpPort") as string | null;
    const smtpPort = smtpPortRaw ? parseInt(smtpPortRaw, 10) : 587;
    const smtpUser = (formData.get("smtpUser") as string | null) || "";

    // Prefer the submitted password; fall back to stored one
    const submittedPass = (formData.get("smtpPass") as string | null) ?? "";
    const smtpPass =
      submittedPass.trim() !== ""
        ? submittedPass
        : (shopRecord.settings?.smtpPass ?? "");

    if (!smtpHost || !smtpUser) {
      return json<ActionData>({
        error: "Please fill in SMTP host and username before testing.",
      });
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.verify();
      return json<ActionData>({ success: "SMTP connection successful!" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json<ActionData>({ error: "SMTP connection failed: " + msg });
    }
  }

  return json<ActionData>({ error: "Unknown intent" }, { status: 400 });
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function SmtpSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  const [smtpEnabled, setSmtpEnabled] = useState<string>(
    settings.smtpEnabled ? "true" : "false"
  );
  const [smtpHost, setSmtpHost] = useState(settings.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(
    settings.smtpPort ? String(settings.smtpPort) : "587"
  );
  const [smtpUser, setSmtpUser] = useState(settings.smtpUser ?? "");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState(settings.smtpFrom ?? "");

  const hasStoredPassword = Boolean(settings.smtpPass);

  const isSubmitting = fetcher.state !== "idle";
  const actionData = fetcher.data;

  function buildFormData(intent: string): FormData {
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("smtpEnabled", smtpEnabled);
    fd.append("smtpHost", smtpHost);
    fd.append("smtpPort", smtpPort);
    fd.append("smtpUser", smtpUser);
    fd.append("smtpPass", smtpPass);
    fd.append("smtpFrom", smtpFrom);
    return fd;
  }

  function handleSave() {
    fetcher.submit(buildFormData("save-smtp"), { method: "post" });
  }

  function handleTest() {
    fetcher.submit(buildFormData("test-smtp"), { method: "post" });
  }

  return (
    <Page>
      <TitleBar title="SMTP Email Settings" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">
                  Send Emails via Your Own SMTP Server
                </Text>
              </BlockStack>

              <Banner tone="info">
                <Text as="p">
                  If enabled, invoices will be sent using your SMTP server
                  instead of the built-in email service.
                </Text>
              </Banner>

              <Divider />

              <FormLayout>
                {/* Enable / Disable */}
                <Select
                  label="SMTP Status"
                  options={[
                    { label: "Disabled (use built-in email service)", value: "false" },
                    { label: "Enabled (use my SMTP server)", value: "true" },
                  ]}
                  value={smtpEnabled}
                  onChange={setSmtpEnabled}
                  helpText="When enabled, all invoice emails will be routed through your SMTP server."
                />

                <Divider />

                {/* SMTP Host */}
                <TextField
                  label="SMTP Host"
                  value={smtpHost}
                  onChange={setSmtpHost}
                  placeholder="e.g., smtp.gmail.com"
                  helpText="The hostname of your outgoing mail server."
                  autoComplete="off"
                />

                {/* SMTP Port */}
                <TextField
                  label="SMTP Port"
                  type="number"
                  value={smtpPort}
                  onChange={setSmtpPort}
                  placeholder="e.g., 587"
                  helpText="Common ports: 587 (TLS/STARTTLS), 465 (SSL), 25 (unencrypted)."
                  autoComplete="off"
                />

                {/* SMTP Username */}
                <TextField
                  label="SMTP Username"
                  type="email"
                  value={smtpUser}
                  onChange={setSmtpUser}
                  placeholder="e.g., you@gmail.com"
                  helpText="Your SMTP login username (usually your email address)."
                  autoComplete="off"
                />

                {/* SMTP Password */}
                <TextField
                  label="SMTP Password"
                  type="password"
                  value={smtpPass}
                  onChange={setSmtpPass}
                  placeholder={
                    hasStoredPassword
                      ? "●●●●●● (saved — leave blank to keep)"
                      : "Enter your SMTP password"
                  }
                  helpText={
                    hasStoredPassword
                      ? "A password is already saved. Leave this blank to keep the existing password."
                      : "Your SMTP authentication password or app-specific password."
                  }
                  autoComplete="new-password"
                />

                {/* From Email Address */}
                <TextField
                  label="From Email Address"
                  type="email"
                  value={smtpFrom}
                  onChange={setSmtpFrom}
                  placeholder="e.g., invoices@mystore.com"
                  helpText="The sender address that will appear in the customer's inbox."
                  autoComplete="off"
                />
              </FormLayout>

              <Divider />

              {/* Feedback banner */}
              {actionData && "success" in actionData && actionData.success && (
                <Banner tone="success" onDismiss={() => {}}>
                  <Text as="p">{actionData.success}</Text>
                </Banner>
              )}
              {actionData && "error" in actionData && actionData.error && (
                <Banner tone="critical" onDismiss={() => {}}>
                  <Text as="p">{actionData.error}</Text>
                </Banner>
              )}

              {/* Action buttons */}
              <InlineStack gap="300" align="start">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={isSubmitting}
                >
                  Save Settings
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  loading={isSubmitting}
                  disabled={!smtpHost || !smtpUser}
                >
                  Test Connection
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
