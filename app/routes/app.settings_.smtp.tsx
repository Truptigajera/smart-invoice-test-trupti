import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Banner, FormLayout, InlineStack, Checkbox, List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

type ActionData = { success?: string; error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, include: { settings: true } });
  const s = shop?.settings;
  return json({
    smtpEnabled: s?.smtpEnabled ?? false,
    smtpHost: s?.smtpHost ?? "",
    smtpPort: s?.smtpPort ? String(s.smtpPort) : "587",
    smtpUser: s?.smtpUser ?? "",
    smtpFrom: s?.smtpFrom ?? "",
    // The password itself is never sent to the browser (it used to be in the page data)
    hasPassword: Boolean(s?.smtpPass),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const str = (k: string) => ((formData.get(k) as string) || "").trim();

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, include: { settings: true } });
  if (!shopRecord) return json<ActionData>({ error: "Shop not found" }, { status: 404 });

  const smtpEnabled = formData.get("smtpEnabled") === "true";
  const smtpHost = str("smtpHost");
  const smtpPort = parseInt(str("smtpPort") || "587", 10);
  const smtpUser = str("smtpUser");
  const smtpFrom = str("smtpFrom");
  // An empty password box means "keep the saved one"
  const smtpPass = str("smtpPass") || shopRecord.settings?.smtpPass || "";

  if (smtpEnabled || intent === "test-smtp") {
    if (!smtpHost || !smtpUser) return json<ActionData>({ error: "Please fill in the SMTP host and username." });
    if (!smtpPass) return json<ActionData>({ error: "Please enter the SMTP password." });
    if (!(smtpPort > 0 && smtpPort < 65536)) return json<ActionData>({ error: "Port must be a number like 587 or 465." });
    if (smtpFrom && !EMAIL_RE.test(smtpFrom)) return json<ActionData>({ error: "\"From\" email address is not valid." });
  }

  if (intent === "test-smtp") {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10000,
      });
      await transporter.verify();
      return json<ActionData>({ success: "Connection works — you can save and enable it." });
    } catch (err) {
      return json<ActionData>({ error: `Could not connect: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  if (intent === "save-smtp") {
    const data = {
      smtpEnabled,
      smtpHost: smtpHost || null,
      smtpPort: smtpHost ? smtpPort : null,
      smtpUser: smtpUser || null,
      smtpFrom: smtpFrom || null,
      ...(str("smtpPass") ? { smtpPass: str("smtpPass") } : {}),
    };
    await prisma.shopSettings.upsert({ where: { shopId: shopRecord.id }, create: { shopId: shopRecord.id, ...data }, update: data });
    return json<ActionData>({ success: smtpEnabled ? "Saved — invoice emails will now be sent from your email server." : "Saved — invoice emails use the built-in email service." });
  }

  return json<ActionData>({ error: "Unknown action" }, { status: 400 });
};

export default function SmtpSettingsPage() {
  const d = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [form, setForm] = useState({
    smtpEnabled: d.smtpEnabled, smtpHost: d.smtpHost, smtpPort: d.smtpPort, smtpUser: d.smtpUser, smtpPass: "", smtpFrom: d.smtpFrom,
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const busy = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const submit = (intent: string) =>
    fetcher.submit({ intent, ...form, smtpEnabled: String(form.smtpEnabled) }, { method: "post" });

  return (
    <Page title="Your own email server (SMTP)" backAction={{ content: "Settings", url: "/app/settings?tab=email" }} fullWidth>
      <TitleBar title="Email server (SMTP)" />
      <InlineStack gap="600" align="start" blockAlign="start" wrap>
        <div style={{ flex: "1 1 220px", maxWidth: 300 }}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Invoice emails normally come from our email service. Connect your own mailbox so customers see your address and replies come to you.
            </Text>
            <Text as="h3" variant="headingXs">Gmail</Text>
            <List type="bullet">
              <List.Item><Text as="span" variant="bodySm">Host smtp.gmail.com, port 587</Text></List.Item>
              <List.Item><Text as="span" variant="bodySm">Password: an App Password (Google Account → Security → App passwords), not your normal password</Text></List.Item>
            </List>
            <Text as="h3" variant="headingXs">Zoho Mail</Text>
            <List type="bullet">
              <List.Item><Text as="span" variant="bodySm">Host smtp.zoho.in, port 465</Text></List.Item>
            </List>
          </BlockStack>
        </div>
        <div style={{ flex: "3 1 420px", minWidth: 0 }}>
          <Card>
            <FormLayout>
              {fetcher.data?.success && <Banner tone="success"><Text as="p" variant="bodySm">{fetcher.data.success}</Text></Banner>}
              {fetcher.data?.error && <Banner tone="critical"><Text as="p" variant="bodySm">{fetcher.data.error}</Text></Banner>}
              <Checkbox
                label="Send invoice emails from my own email server"
                checked={form.smtpEnabled} onChange={(v) => setForm((f) => ({ ...f, smtpEnabled: v }))}
              />
              <FormLayout.Group>
                <TextField label="SMTP host" value={form.smtpHost} onChange={set("smtpHost")} placeholder="smtp.gmail.com" autoComplete="off" />
                <TextField label="Port" value={form.smtpPort} onChange={(v) => set("smtpPort")(v.replace(/\D/g, "").slice(0, 5))} placeholder="587" autoComplete="off" inputMode="numeric" />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField label="Username" value={form.smtpUser} onChange={set("smtpUser")} placeholder="you@yourstore.com" autoComplete="off" />
                <TextField
                  label="Password" type="password" value={form.smtpPass} onChange={set("smtpPass")} autoComplete="new-password"
                  placeholder={d.hasPassword ? "Saved — leave empty to keep" : ""}
                />
              </FormLayout.Group>
              <TextField label="From email address" type="email" value={form.smtpFrom} onChange={set("smtpFrom")} placeholder="Same as username" autoComplete="off" helpText="The sender customers see. Most providers only allow your own mailbox address." />
              <InlineStack gap="300">
                <Button variant="primary" loading={busy === "save-smtp"} disabled={!!busy && busy !== "save-smtp"} onClick={() => submit("save-smtp")}>Save</Button>
                <Button loading={busy === "test-smtp"} disabled={!form.smtpHost || !form.smtpUser || (!!busy && busy !== "test-smtp")} onClick={() => submit("test-smtp")}>Test connection</Button>
              </InlineStack>
            </FormLayout>
          </Card>
        </div>
      </InlineStack>
    </Page>
  );
}
