import { prisma } from "~/db.server";

// Generate next invoice number and increment counter atomically
export async function generateInvoiceNumber(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { invoicePrefix: true, invoiceCounter: true },
  });

  if (!shop) throw new Error("Shop not found");

  const number = String(shop.invoiceCounter).padStart(4, "0");
  const invoiceNumber = `${shop.invoicePrefix}-${number}`;

  // Increment counter
  await prisma.shop.update({
    where: { id: shopId },
    data: { invoiceCounter: { increment: 1 } },
  });

  return invoiceNumber;
}

// Check if shop has reached monthly order limit for their plan
export async function checkOrderLimit(shopId: string): Promise<{ allowed: boolean; limit: number; used: number }> {
  const PLAN_LIMITS: Record<string, number> = {
    free: 50,
    starter: 300,
    business: 2500,
    advanced: Infinity,
  };

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { currentPlan: true, ordersThisMonth: true, planResetDate: true },
  });

  if (!shop) return { allowed: false, limit: 0, used: 0 };

  // Reset counter if new month
  const now = new Date();
  const resetDate = shop.planResetDate ? new Date(shop.planResetDate) : null;
  if (!resetDate || now > resetDate) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await prisma.shop.update({
      where: { id: shopId },
      data: { ordersThisMonth: 0, planResetDate: nextReset },
    });
    return { allowed: true, limit: PLAN_LIMITS[shop.currentPlan] ?? 50, used: 0 };
  }

  const limit = PLAN_LIMITS[shop.currentPlan] ?? 50;
  const used = shop.ordersThisMonth;

  return { allowed: used < limit, limit, used };
}

// Increment monthly order counter
export async function incrementOrderCount(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: { ordersThisMonth: { increment: 1 } },
  });
}
