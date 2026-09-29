import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { Modal, Text, BlockStack } from "@shopify/polaris";

const EVENT = "plan-limit-reached";

// Call with any fetcher's data: when the server answered { limitReached: true }
// (see planLimitBody in plan-limits.server), the upgrade popup opens.
export function usePlanLimitPopup(data: unknown) {
  useEffect(() => {
    const d = data as { limitReached?: boolean; limit?: number } | undefined;
    if (d?.limitReached) {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { limit: d.limit } }));
    }
  }, [data]);
}

// Mounted once in the /app layout, so every page shares the same popup
export function PlanLimitModal() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    const open = (e: Event) => setLimit((e as CustomEvent<{ limit?: number }>).detail?.limit ?? 0);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  return (
    <Modal
      open={limit !== null}
      onClose={() => setLimit(null)}
      title="Free plan limit reached"
      primaryAction={{
        content: "Upgrade plan",
        onAction: () => {
          setLimit(null);
          navigate("/app/billing");
        },
      }}
      secondaryActions={[{ content: "Not now", onAction: () => setLimit(null) }]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            You've created all {limit} free invoices for this month.
          </Text>
          <Text as="p" variant="bodyMd">
            Upgrade your plan to keep creating GST invoices for new orders. Invoices you've
            already created stay available to view, print and download.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
