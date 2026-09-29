import { prisma } from "~/db.server";
import {
  PLAN_STARTUP, PLAN_BUSINESS, PLAN_ADVANCED,
  PLAN_STARTUP_ANNUAL, PLAN_BUSINESS_ANNUAL, PLAN_ADVANCED_ANNUAL,
  FREE_ORDER_LIMIT,
} from "~/billing-plans";

export const PLAN_ORDER_LIMITS: Record<string, number | null> = {
  free: FREE_ORDER_LIMIT,
  [PLAN_STARTUP]: 300,
  [PLAN_BUSINESS]: 2500,
  [PLAN_ADVANCED]: null,
  [PLAN_STARTUP_ANNUAL]: 300,
  [PLAN_BUSINESS_ANNUAL]: 2500,
  [PLAN_ADVANCED_ANNUAL]: null,
};

export function getOrderLimit(planKey: string): number | null {
  return planKey in PLAN_ORDER_LIMITS ? PLAN_ORDER_LIMITS[planKey] : FREE_ORDER_LIMIT;
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

// Returns true if the shop has exceeded its plan limit
export async function isOverLimit(shopId: string, planKey: string): Promise<boolean> {
  const limit = getOrderLimit(planKey);
  if (limit === null) return false; // unlimited

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ordersThisMonth: true, planResetDate: true },
  });
  if (!shop) return false;

  // Reset if new month
  const now = new Date();
  const resetDate = shop.planResetDate ? new Date(shop.planResetDate) : null;
  if (!resetDate || now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    return false; // fresh month, not over limit
  }

  return shop.ordersThisMonth >= limit;
}
