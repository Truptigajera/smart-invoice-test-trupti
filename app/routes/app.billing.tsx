import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Box,
  Banner,
  ProgressBar,
  Icon,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";
import { PLAN_PRO, PLAN_PRO_PRICE, BILLING_IS_TEST } from "../billing-plans";
import prisma from "../db.server";

// ── Plans ────────────────────────────────────────────────────────────────────

interface PlanInfo {
  key: "free" | "pro";
  name: string;
  price: string;
  subPrice: string;
  features: string[];
}

const PLANS: PlanInfo[] = [
  {
    key: "free",
    name: "Free",
    price: "Free",
    subPrice: "",
    features: [
      "{limit} invoices / month", // {limit} is filled with this store's limit when rendering
      "GST Invoice PDF (CGST / SGST / IGST)",
      "Template 1",
      "GSTIN validation",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: `$${PLAN_PRO_PRICE.toFixed(2)}/mo`,
    subPrice: "billed monthly",
    features: [
      "Unlimited invoices",
      "All invoice & packing slip templates",
      "Estimates / quotation PDFs from draft orders",
      "GST Reports (GSTR-1, 3B) & Tally export",
      "Auto email, bulk download & bulk email",
      "B2B customers, E-Invoice (IRN), WhatsApp",
      "Multi-location GSTIN & custom SMTP",
    ],
  },
];

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  // Any active subscription is paid — Pro, or a retired plan an existing merchant is still on
  const billingCheck = await billing.check({ isTest: BILLING_IS_TEST });
  const activeSub = billingCheck.appSubscriptions[0] ?? null;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { ordersThisMonth: true, planResetDate: true, freeInvoiceLimit: true },
  });

  // The counter only resets when the next invoice is created, so a count from a past month is 0
  const now = new Date();
  const reset = shop?.planResetDate ? new Date(shop.planResetDate) : null;
  const countIsThisMonth = !!reset && reset.getMonth() === now.getMonth() && reset.getFullYear() === now.getFullYear();

  return json({
    currentPlanKey: activeSub ? "pro" : "free",
    activeSub: activeSub ? { id: activeSub.id, name: activeSub.name, test: activeSub.test } : null,
    invoicesThisMonth: countIsThisMonth ? shop?.ordersThisMonth ?? 0 : 0,
    // This store's free limit, editable in the DB (Shop.freeInvoiceLimit)
    freeLimit: shop?.freeInvoiceLimit ?? 0,
  });
};

// ── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "subscribe") {
    // Redirects the merchant to Shopify's charge approval page — code below never runs
    await billing.request({ plan: PLAN_PRO, isTest: BILLING_IS_TEST });
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    await billing.cancel({ subscriptionId, isTest: BILLING_IS_TEST, prorate: false });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Component ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { currentPlanKey, activeSub, invoicesThisMonth, freeLimit } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const busyIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;

  const isFree = currentPlanKey === "free";
  const usagePercent = isFree ? (freeLimit > 0 ? Math.min((invoicesThisMonth / freeLimit) * 100, 100) : 100) : 0;

  const handleSubscribe = useCallback(() => {
    fetcher.submit({ intent: "subscribe" }, { method: "POST" });
  }, [fetcher]);

  const handleCancel = useCallback(() => {
    if (!activeSub) return;
    fetcher.submit({ intent: "cancel", subscriptionId: activeSub.id }, { method: "POST" });
  }, [fetcher, activeSub]);

  return (
    <Page title="Plans & Billing">
      <TitleBar title="Plans & Billing" />
      <BlockStack gap="500">

        {/* Usage card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Current Plan:{" "}
                  <Text as="span" variant="headingMd" tone="success" fontWeight="bold">
                    {isFree ? "Free" : "Pro"}
                  </Text>
                </Text>
                {activeSub?.test && <Badge tone="attention">Test charge</Badge>}
              </InlineStack>
              {!isFree && (
                <Button variant="plain" tone="critical" onClick={handleCancel} loading={busyIntent === "cancel"}>
                  Cancel subscription
                </Button>
              )}
            </InlineStack>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="p" variant="bodySm" tone="subdued">Invoices this month</Text>
                <Text as="p" variant="bodySm">
                  {invoicesThisMonth}
                  {isFree ? ` / ${freeLimit}` : " (Unlimited)"}
                </Text>
              </InlineStack>
              {isFree && (
                <ProgressBar
                  progress={usagePercent}
                  tone={usagePercent >= 100 ? "critical" : usagePercent >= 70 ? "highlight" : "success"}
                  size="small"
                />
              )}
            </BlockStack>

            {isFree && invoicesThisMonth >= freeLimit ? (
              <Banner tone="critical">
                You've used all {freeLimit} free invoices this month. Upgrade to Pro to keep creating GST invoices.
              </Banner>
            ) : isFree && usagePercent >= 70 ? (
              <Banner tone="warning">
                You've used {invoicesThisMonth} of {freeLimit} free invoices this month.
              </Banner>
            ) : null}
          </BlockStack>
        </Card>

        {/* Plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "16px",
          }}
        >
          {PLANS.map((plan) => {
            const isCurrent = plan.key === currentPlanKey;
            const isPro = plan.key === "pro";

            return (
              <div
                key={plan.key}
                style={{
                  borderRadius: "8px",
                  border: isPro ? "2px solid #008060" : isCurrent ? "2px solid #1a73e8" : "1px solid #e1e3e5",
                  overflow: "hidden",
                }}
              >
                {isPro && (
                  <Box background="bg-fill-success" padding="100">
                    <Text as="p" variant="bodySm" alignment="center" fontWeight="semibold" tone="success">
                      Recommended
                    </Text>
                  </Box>
                )}
                <Box padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <Text as="h3" variant="headingMd">{plan.name}</Text>
                      {isCurrent && <Badge tone="success">Current</Badge>}
                    </InlineStack>

                    <BlockStack gap="050">
                      <Text as="p" variant="headingXl" fontWeight="bold">{plan.price}</Text>
                      {plan.subPrice && (
                        <Text as="p" variant="bodySm" tone="subdued">{plan.subPrice}</Text>
                      )}
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="150">
                      {plan.features.map((feature) => (
                        <InlineStack key={feature} gap="150" blockAlign="start">
                          <Box>
                            <Icon source={CheckIcon} tone="success" />
                          </Box>
                          <Text as="p" variant="bodySm">{feature.replace("{limit}", String(freeLimit))}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>

                    <Box paddingBlockStart="200">
                      {isCurrent ? (
                        <Button fullWidth disabled variant="secondary">Current Plan</Button>
                      ) : isPro ? (
                        <Button fullWidth variant="primary" onClick={handleSubscribe} loading={busyIntent === "subscribe"}>
                          Upgrade to Pro
                        </Button>
                      ) : (
                        <Button fullWidth variant="secondary" onClick={handleCancel} loading={busyIntent === "cancel"}>
                          Downgrade to Free
                        </Button>
                      )}
                    </Box>
                  </BlockStack>
                </Box>
              </div>
            );
          })}
        </div>

        <Box paddingBlockEnd="400">
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            All prices in USD. Billing is managed through Shopify. Cancel anytime.
          </Text>
        </Box>

      </BlockStack>
    </Page>
  );
}
