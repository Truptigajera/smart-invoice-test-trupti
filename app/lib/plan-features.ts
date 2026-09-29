// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for plan gating.
// To change which plan a feature requires → edit FEATURE_PLAN below. That's it.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanTier = "free" | "starter" | "growth" | "scale";

export type FeatureKey =
  | "all-templates"        // Templates 2-6 (free gets only Template 1)
  | "template-customizer"  // Deep per-template customizer
  | "auto-email"           // Auto-send invoice on fulfillment
  | "bulk-download"        // Bulk PDF ZIP download
  | "bulk-email"           // Bulk invoice email send
  | "gstr-reports"         // GSTR-1, GSTR-3B reports
  | "packing-slip"         // Packing slip PDF
  | "estimates"            // Estimates / Draft order quotations
  | "hsn-management"       // Products HSN code management
  | "whatsapp"             // WhatsApp invoice sharing
  | "tally-export"         // Tally XML export
  | "custom-fields"        // Custom invoice fields
  | "b2b-customers"        // B2B customer GSTIN management
  | "multi-location"       // Multi-location GSTIN settings
  | "smtp-email"           // Custom SMTP email
  | "einvoice";            // E-Invoice IRN generation (NIC IRP)

// ── Change only this map to re-tier any feature ──────────────────────────────
export const FEATURE_PLAN: Record<FeatureKey, PlanTier> = {
  "all-templates":        "starter",
  "template-customizer":  "starter",
  "auto-email":           "starter",
  "bulk-download":        "starter",
  "bulk-email":           "starter",
  "gstr-reports":         "starter",
  "packing-slip":         "starter",
  "estimates":            "starter",
  "hsn-management":       "starter",
  "whatsapp":             "growth",
  "tally-export":         "growth",
  "custom-fields":        "growth",
  "b2b-customers":        "growth",
  "multi-location":       "growth",
  "smtp-email":           "growth",
  "einvoice":             "scale",
};

// ── Plan hierarchy ────────────────────────────────────────────────────────────
const TIER_RANK: Record<PlanTier, number> = {
  free:    0,
  starter: 1,
  growth:  2,
  scale:   3,
};

// Only Free and Pro are sold now, so every paid tier is presented as "Pro" in upgrade prompts.
// starter/growth remain for merchants still on the retired Startup/Business plans.
export const PLAN_META: Record<PlanTier, { name: string; upgradeLabel: string }> = {
  free:    { name: "Free", upgradeLabel: "Upgrade to Pro" },
  starter: { name: "Pro",  upgradeLabel: "Upgrade to Pro" },
  growth:  { name: "Pro",  upgradeLabel: "Upgrade to Pro" },
  scale:   { name: "Pro",  upgradeLabel: "" },
};

// ── Normalize Shopify billing plan name → internal tier ──────────────────────
export function normalizePlan(currentPlan: string): PlanTier {
  const p = (currentPlan || "").toLowerCase();
  if (!p || p === "free") return "free";
  // Retired plans keep the features they were sold with
  if (p.includes("startup") || p === "starter") return "starter";
  if (p.includes("business") || p === "growth") return "growth";
  // Pro (and retired Advanced) unlock everything
  return "scale";
}

// ── Main check ────────────────────────────────────────────────────────────────
export function canUseFeature(currentPlan: string, feature: FeatureKey): boolean {
  const userRank    = TIER_RANK[normalizePlan(currentPlan)];
  const featureRank = TIER_RANK[FEATURE_PLAN[feature]];
  return userRank >= featureRank;
}

// Required plan display name for a feature (used in upgrade prompts)
export function requiredPlan(feature: FeatureKey): string {
  return PLAN_META[FEATURE_PLAN[feature]].name;
}
