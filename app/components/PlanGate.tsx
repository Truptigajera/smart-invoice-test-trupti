import { BlockStack, Box, Button, InlineStack, Text } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import { canUseFeature, requiredPlan } from "~/lib/plan-features";
import type { FeatureKey } from "~/lib/plan-features";

interface PlanGateProps {
  currentPlan: string;
  feature: FeatureKey;
  children: React.ReactNode;
}

// Wraps a UI section. If the user's plan can use the feature, renders children.
// Otherwise renders a lock overlay with an upgrade CTA.
export function PlanGate({ currentPlan, feature, children }: PlanGateProps) {
  if (canUseFeature(currentPlan, feature)) return <>{children}</>;

  const needed = requiredPlan(feature);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ pointerEvents: "none", opacity: 0.4, userSelect: "none" }}>
        {children}
      </div>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,255,255,0.75)", borderRadius: 8,
        backdropFilter: "blur(2px)",
      }}>
        <Box
          padding="400"
          background="bg-surface"
          borderWidth="025"
          borderColor="border"
          borderRadius="200"
          shadow="200"
        >
          <BlockStack gap="300" inlineAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <div style={{ color: "#6B7280" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </div>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {needed} Plan Required
              </Text>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              Upgrade to {needed} to unlock this feature.
            </Text>
            <Link to="/app/billing" style={{ textDecoration: "none" }}>
              <Button variant="primary" size="slim">
                Upgrade to {needed}
              </Button>
            </Link>
          </BlockStack>
        </Box>
      </div>
    </div>
  );
}

// Inline lock badge — for use inside table rows or compact UI, not a full overlay
export function PlanLockBadge({ currentPlan, feature }: { currentPlan: string; feature: FeatureKey }) {
  if (canUseFeature(currentPlan, feature)) return null;
  const needed = requiredPlan(feature);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: "#FEF3C7", color: "#92400E",
      fontSize: 11, fontWeight: 600, padding: "2px 8px",
      borderRadius: 12, border: "1px solid #FDE68A",
      whiteSpace: "nowrap",
    }}>
      <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      {needed}+
    </span>
  );
}
