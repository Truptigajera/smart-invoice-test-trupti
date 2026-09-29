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
