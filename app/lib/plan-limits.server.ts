import { prisma } from "~/db.server";
// Monthly invoice limit — null means unlimited. planKey is shop.currentPlan: "free", or the name of
// the active Shopify subscription. Any paid subscription (Pro, or a retired Startup/Business/Advanced
// plan an existing merchant is still on) is unlimited. freeLimit is the store's Shop.freeInvoiceLimit.
export function getOrderLimit(planKey: string, freeLimit: number): number | null {
  return !planKey || planKey === "free" ? freeLimit : null;
}

// Increment monthly order counter, reset if new month
export async function incrementOrderCount(shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ordersThisMonth: true, planResetDate: true },
  });
  if (!shop) return;

  const now = new Date();
  const needsReset =
    !shop.planResetDate ||
    now.getMonth() !== new Date(shop.planResetDate).getMonth() ||
    now.getFullYear() !== new Date(shop.planResetDate).getFullYear();

  await prisma.shop.update({
    where: { id: shopId },
    data: {
      ordersThisMonth: needsReset ? 1 : { increment: 1 },
      planResetDate: needsReset ? now : undefined,
    },
  });
}

// The shop's limit (read fresh from the DB, so a value edited there applies immediately)
// and whether it has been used up this month
async function getLimitState(shopId: string, planKey: string): Promise<{ limit: number | null; over: boolean }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ordersThisMonth: true, planResetDate: true, freeInvoiceLimit: true },
  });
  if (!shop) return { limit: null, over: false };

  const limit = getOrderLimit(planKey, shop.freeInvoiceLimit);
  if (limit === null) return { limit, over: false }; // unlimited

  // Reset if new month
  const now = new Date();
  const resetDate = shop.planResetDate ? new Date(shop.planResetDate) : null;
  if (!resetDate || now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    return { limit, over: false }; // fresh month, not over limit
  }

  return { limit, over: shop.ordersThisMonth >= limit };
}

// Returns true if the shop has exceeded its plan limit
export async function isOverLimit(shopId: string, planKey: string): Promise<boolean> {
  return (await getLimitState(shopId, planKey)).over;
}

// Thrown by createInvoiceFromOrder when the monthly invoice limit is used up.
// Routes turn it into { limitReached: true } so the UI can show the upgrade popup.
export class PlanLimitError extends Error {
  constructor(public limit: number) {
    super(`You've used all ${limit} free invoices for this month. Upgrade your plan to create unlimited invoices.`);
    this.name = "PlanLimitError";
  }
}

export async function assertCanCreateInvoice(shopId: string, planKey: string): Promise<void> {
  const { limit, over } = await getLimitState(shopId, planKey);
  if (over) throw new PlanLimitError(limit ?? 0);
}

// JSON body for an action that hit the limit — the UI shows the upgrade popup for `limitReached`
export function planLimitBody(err: PlanLimitError) {
  return { error: err.message, limitReached: true as const, limit: err.limit };
}
