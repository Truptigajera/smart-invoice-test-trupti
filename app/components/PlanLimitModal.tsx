import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { Modal, Text, BlockStack } from "@shopify/polaris";

const EVENT = "plan-limit-reached";

type PopupContent = { title: string; lines: string[] };

// Opens the shared upgrade popup from anywhere on the client
export function openUpgradePopup(content: PopupContent) {
  window.dispatchEvent(new CustomEvent<PopupContent>(EVENT, { detail: content }));
}

// Call with any fetcher's data: when the server answered { limitReached: true }
// (see planLimitBody in plan-limits.server), the upgrade popup opens.
export function usePlanLimitPopup(data: unknown) {
  useEffect(() => {
    const d = data as { limitReached?: boolean; limit?: number } | undefined;
    if (d?.limitReached) {
      openUpgradePopup({
        title: "Free plan limit reached",
        lines: [
          `You've created all ${d.limit ?? 0} free invoices for this month.`,
          "Upgrade your plan to keep creating GST invoices for new orders. Invoices you've already created stay available to view, print and download.",
        ],
      });
    }
  }, [data]);
}

// Mounted once in the /app layout, so every page shares the same popup
export function PlanLimitModal() {
  const navigate = useNavigate();
  const [content, setContent] = useState<PopupContent | null>(null);

  useEffect(() => {
    const open = (e: Event) => setContent((e as CustomEvent<PopupContent>).detail);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  return (
    <Modal
      open={content !== null}
      onClose={() => setContent(null)}
      title={content?.title ?? ""}
      primaryAction={{
        content: "Upgrade to Pro",
        onAction: () => {
          setContent(null);
          navigate("/app/billing");
        },
      }}
      secondaryActions={[{ content: "Not now", onAction: () => setContent(null) }]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          {content?.lines.map((line) => (
            <Text key={line} as="p" variant="bodyMd">{line}</Text>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
