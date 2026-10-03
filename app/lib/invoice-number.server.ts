import { prisma } from "~/db.server";

// Indian financial year (April–March) as a short label, e.g. "26-27" for Apr 2026 – Mar 2027.
// Always computed on the Indian calendar.
export function financialYearLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

// What an invoice number looks like for the given settings (also used for the Settings preview)
export function formatInvoiceNumber(opts: {
  prefix: string; counter: number; includeFinancialYear: boolean; fy?: string;
}): string {
  const serial = String(opts.counter).padStart(4, "0");
  return opts.includeFinancialYear
    ? `${opts.prefix}/${opts.fy ?? financialYearLabel()}/${serial}`
    : `${opts.prefix}-${serial}`;
}

// Next invoice number for a shop.
// - "order_number": uses the Shopify order number (INV-1430) when one is given
// - otherwise a running counter, optionally with the financial year (INV/26-27/0001) — then the
//   counter restarts every April, since GST numbering must be unique within a financial year
// These settings used to be shown in Settings but were never applied.
export async function generateInvoiceNumber(shopId: string, orderName?: string | null): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { invoicePrefix: true, invoiceCounterFy: true, settings: { select: { invoiceNumberType: true, includeFinancialYear: true } } },
  });
  if (!shop) throw new Error("Shop not found");

  const prefix = shop.invoicePrefix || "INV";
  const orderDigits = (orderName || "").replace(/\D/g, "");
  if (shop.settings?.invoiceNumberType === "order_number" && orderDigits) {
    return `${prefix}-${orderDigits}`;
  }

  const includeFy = shop.settings?.includeFinancialYear === true;
  const fy = financialYearLabel();
  if (includeFy && shop.invoiceCounterFy && shop.invoiceCounterFy !== fy) {
    // New financial year — restart numbering (only this shop's first invoice of the year gets here)
    await prisma.shop.updateMany({
      where: { id: shopId, invoiceCounterFy: shop.invoiceCounterFy },
      data: { invoiceCounter: 1, invoiceCounterFy: fy },
    });
  } else if (!shop.invoiceCounterFy) {
    await prisma.shop.update({ where: { id: shopId }, data: { invoiceCounterFy: fy } });
  }

  // Atomic increment: two orders paid at the same moment can't get the same number
  // (the old read-then-write could hand both the same counter value)
  const updated = await prisma.shop.update({
    where: { id: shopId },
    data: { invoiceCounter: { increment: 1 } },
    select: { invoiceCounter: true },
  });
  return formatInvoiceNumber({ prefix, counter: updated.invoiceCounter - 1, includeFinancialYear: includeFy, fy });
}
