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
  Tabs,
  ProgressBar,
  Icon,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
  PLAN_STARTUP,
  PLAN_BUSINESS,
  PLAN_ADVANCED,
  PLAN_STARTUP_ANNUAL,
  PLAN_BUSINESS_ANNUAL,
  PLAN_ADVANCED_ANNUAL,
} from "../billing-plans";
import prisma from "../db.server";

// ── Types ────────────────────────────────────────────────────────────────────

interface PlanInfo {
  key: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;    // total per year
  annualMonthly: number;  // per-month when billed annually
  orderLimit: number | null;
  highlight: boolean;
  features: string[];
}

const PLANS: PlanInfo[] = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    annualMonthly: 0,
    orderLimit: 50,
    highlight: false,
    features: [
      "50 orders / month",
      "GST Invoice PDF",
      "Email delivery",
      "Template 1",
      "GSTIN validation",
    ],
  },
  {
    key: "startup",
    name: "Startup",
    monthlyPrice: 9.9,
    annualPrice: 77.28,
    annualMonthly: 6.44,
    orderLimit: 300,
    highlight: false,
    features: [
      "300 orders / month",
      "Everything in Free",
      "All invoice templates",
      "GST Reports (GSTR-1, 3B)",
      "Priority support",
    ],
  },
  {
    key: "business",
    name: "Business",
    monthlyPrice: 19.98,
    annualPrice: 155.88,
    annualMonthly: 12.99,
    orderLimit: 2500,
    highlight: true,
    features: [
      "2500 orders / month",
      "Everything in Startup",
      "E-Invoice (IRN + QR code)",
      "B2B customer GSTIN",
      "Packing Slip",
    ],
  },
  {
    key: "advanced",
    name: "Advanced",
    monthlyPrice: 69.98,
    annualPrice: 545.88,
    annualMonthly: 45.49,
    orderLimit: null,
    highlight: false,
    features: [
      "Unlimited orders",
      "Everything in Business",
      "Multi-location GSTIN",
      "Tally integration",
      "WhatsApp delivery",
    ],
  },
];

function getPlanKey(subscriptionName: string): string {
  if (subscriptionName === PLAN_STARTUP || subscriptionName === PLAN_STARTUP_ANNUAL) return "startup";
  if (subscriptionName === PLAN_BUSINESS || subscriptionName === PLAN_BUSINESS_ANNUAL) return "business";
  if (subscriptionName === PLAN_ADVANCED || subscriptionName === PLAN_ADVANCED_ANNUAL) return "advanced";
  return "free";
}

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const isTest = process.env.NODE_ENV !== "production";
  const billingCheck = await billing.check({
    plans: [
      PLAN_STARTUP, PLAN_BUSINESS, PLAN_ADVANCED,
      PLAN_STARTUP_ANNUAL, PLAN_BUSINESS_ANNUAL, PLAN_ADVANCED_ANNUAL,
    ],
    isTest,
  });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { ordersThisMonth: true, planResetDate: true },
  });

  const activeSub = billingCheck.appSubscriptions[0] ?? null;
  const currentPlanKey = activeSub ? getPlanKey(activeSub.name) : "free";

  return json({
    currentPlanKey,
    activeSub: activeSub
      ? {
          id: activeSub.id,
          name: activeSub.name,
          trialDays: activeSub.trialDays ?? 0,
        }
      : null,
    ordersThisMonth: shop?.ordersThisMonth ?? 0,
    planResetDate: shop?.planResetDate?.toISOString() ?? null,
  });
};

// ── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  type PlanKey = typeof PLAN_STARTUP | typeof PLAN_BUSINESS | typeof PLAN_ADVANCED | typeof PLAN_STARTUP_ANNUAL | typeof PLAN_BUSINESS_ANNUAL | typeof PLAN_ADVANCED_ANNUAL;
  const plan = formData.get("plan") as PlanKey;

  const isTest = process.env.NODE_ENV !== "production";

  if (intent === "subscribe") {
    await billing.request({ plan, isTest });
    // billing.request throws a redirect — code below never runs
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    await billing.cancel({ subscriptionId, isTest, prorate: false });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Component ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { currentPlanKey, activeSub, ordersThisMonth } = useLoaderData<typeof loader>();
  const [billingTabIndex, setBillingTabIndex] = useState(0);
  const isAnnual = billingTabIndex === 1;
  const fetcher = useFetcher();
  const [loadingPlanKey, setLoadingPlanKey] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle") setLoadingPlanKey(null);
  }, [fetcher.state]);

  const currentPlanInfo = PLANS.find((p) => p.key === currentPlanKey) ?? PLANS[0];
  const orderLimit = currentPlanInfo.orderLimit ?? 0;
  const usagePercent = orderLimit > 0 ? Math.min((ordersThisMonth / orderLimit) * 100, 100) : 0;

  const handleSubscribe = useCallback(
    (planKey: string) => {
      let planName: string;
      if (planKey === "startup") planName = isAnnual ? PLAN_STARTUP_ANNUAL : PLAN_STARTUP;
      else if (planKey === "business") planName = isAnnual ? PLAN_BUSINESS_ANNUAL : PLAN_BUSINESS;
      else planName = isAnnual ? PLAN_ADVANCED_ANNUAL : PLAN_ADVANCED;

      setLoadingPlanKey(planKey);
      fetcher.submit({ intent: "subscribe", plan: planName }, { method: "POST" });
    },
    [fetcher, isAnnual]
  );

  const handleCancel = useCallback(() => {
    if (!activeSub) return;
    fetcher.submit(
      { intent: "cancel", subscriptionId: activeSub.id },
      { method: "POST" }
    );
  }, [fetcher, activeSub]);

  const tabs = [
    { id: "monthly", content: "Monthly" },
    { id: "annual", content: "Annual (Save ~35%)" },
  ];

  return (
    <Page title="Plans & Billing">
      <TitleBar title="Plans & Billing" />
      <BlockStack gap="500">

        {/* Usage card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  Current Plan:{" "}
                  <Text as="span" variant="headingMd" tone="success" fontWeight="bold">
                    {currentPlanInfo.name}
                  </Text>
                </Text>
                {activeSub?.trialDays && activeSub.trialDays > 0 ? (
                  <Badge tone="attention">Trial active</Badge>
                ) : null}
              </BlockStack>
              {currentPlanKey !== "free" && (
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={handleCancel}
                  loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "cancel"}
                >
                  Cancel subscription
                </Button>
              )}
            </InlineStack>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="p" variant="bodySm" tone="subdued">
                  Orders this month
                </Text>
                <Text as="p" variant="bodySm">
                  {ordersThisMonth}
                  {currentPlanInfo.orderLimit ? ` / ${currentPlanInfo.orderLimit}` : " (Unlimited)"}
                </Text>
              </InlineStack>
              {currentPlanInfo.orderLimit && (
                <ProgressBar
                  progress={usagePercent}
                  tone={usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "highlight" : "success"}
                  size="small"
                />
              )}
            </BlockStack>

            {usagePercent >= 80 && currentPlanKey !== "advanced" && (
              <Banner tone="warning">
                You have used {Math.round(usagePercent)}% of your monthly order limit. Consider upgrading to avoid disruption.
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Billing interval toggle */}
        <Tabs tabs={tabs} selected={billingTabIndex} onSelect={setBillingTabIndex} fitted />

        {/* Plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {PLANS.map((plan) => {
            const isCurrent = plan.key === currentPlanKey;
            const price = plan.key === "free"
              ? "Free"
              : isAnnual
                ? `$${plan.annualMonthly.toFixed(2)}/mo`
                : `$${plan.monthlyPrice.toFixed(2)}/mo`;
            const subPrice = plan.key !== "free" && isAnnual
              ? `$${plan.annualPrice.toFixed(2)} billed annually`
              : plan.key !== "free"
                ? "billed monthly"
                : "";

            return (
              <div
                key={plan.key}
                style={{
                  borderRadius: "8px",
                  border: plan.highlight
                    ? "2px solid #008060"
                    : isCurrent
                      ? "2px solid #1a73e8"
                      : "1px solid #e1e3e5",
                  overflow: "hidden",
                }}
              >
                {plan.highlight && (
                  <Box background="bg-fill-success" padding="100">
                    <Text as="p" variant="bodySm" alignment="center" fontWeight="semibold" tone="success">
                      Most Popular
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
                      <Text as="p" variant="headingXl" fontWeight="bold">{price}</Text>
                      {subPrice && (
                        <Text as="p" variant="bodySm" tone="subdued">{subPrice}</Text>
                      )}
                      {plan.key !== "free" && (
                        <Text as="p" variant="bodySm" tone="subdued">7-day free trial</Text>
                      )}
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="150">
                      {plan.features.map((feature) => (
                        <InlineStack key={feature} gap="150" blockAlign="start">
                          <Box>
                            <Icon source={CheckIcon} tone="success" />
                          </Box>
                          <Text as="p" variant="bodySm">{feature}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>

                    <Box paddingBlockStart="200">
                      {isCurrent ? (
                        <Button fullWidth disabled variant="secondary">
                          Current Plan
                        </Button>
                      ) : plan.key === "free" ? (
                        <Button fullWidth variant="secondary" onClick={handleCancel} disabled={currentPlanKey === "free"}>
                          Downgrade to Free
                        </Button>
                      ) : (
                        <Button
                          fullWidth
                          variant={plan.highlight ? "primary" : "secondary"}
                          onClick={() => handleSubscribe(plan.key)}
                          loading={loadingPlanKey === plan.key}
                        >
                          {currentPlanKey === "free"
                            ? `Start Free Trial`
                            : plan.key > currentPlanKey
                              ? "Upgrade"
                              : "Downgrade"}
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
