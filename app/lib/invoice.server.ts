import { prisma } from "~/db.server";
import {
  determineTaxType,
  calculateLineTax,
  getStateCodeFromGstin,
  getIndianStateCode,
  amountToWords,
} from "~/lib/gst";
import { generateInvoiceNumber } from "~/lib/invoice-number.server";
import { incrementOrderCount } from "~/lib/plan-limits.server";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Shopify order type (minimal fields we need)
export interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  phone?: string;
  billing_address?: {
    first_name?: string;
    last_name?: string;
    address1?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    country?: string;
  };
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    address1?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    country?: string;
  };
  line_items: Array<{
    title: string;
    variant_title?: string;
    quantity: number;
    price: string;
    total_discount: string;
    tax_lines: Array<{ rate: number; price: string; title: string }>;
    properties?: Array<{ name: string; value: string }>;
  }>;
  total_price: string;
  total_tax: string;
  total_discounts: string;
  taxes_included?: boolean;
  note?: string;
  payment_gateway?: string;
  tags?: string;
  note_attributes?: Array<{ name: string; value: string }>;
  shipping_lines?: Array<{
    price: string;
    tax_lines?: Array<{ rate: number; price: string }>;
  }>;
}

export async function createInvoiceFromOrder(
  shopDomain: string,
  order: ShopifyOrder
): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });

  if (!shop) throw new Error(`Shop not found: ${shopDomain}`);

  const orderId = String(order.id);

  // Check if invoice already exists for this order
  const existing = await prisma.invoice.findFirst({
    where: { shopId: shop.id, orderId },
  });
  if (existing) return existing.id;

  const invoiceNumber = await generateInvoiceNumber(shop.id);
  await incrementOrderCount(shop.id);

  // Determine tax type
  const sellerStateCode = shop.stateCode || getStateCodeFromGstin(shop.gstin || "");
  const buyerProvince = order.billing_address?.province_code || "";
  // Map Shopify province code to Indian state code (simplified - use billing address state)
  const buyerStateCode = getIndianStateCode(buyerProvince, order.billing_address?.province || "");
  const taxType = determineTaxType(sellerStateCode, buyerStateCode);

  // Build line items
  let totalSubtotal = 0;
  let totalDiscount = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  // Most Indian Shopify stores use "taxes included in price" (MRP pricing).
  // When true: the Shopify price already includes GST → back-calculate taxable value.
  // When false: price is pre-tax → taxable = price × qty - discount.
  const taxesIncluded = order.taxes_included !== false;

  const lineItemsData = order.line_items.map((item) => {
    const unitPrice = parseFloat(item.price);
    const listTotal = r2(unitPrice * item.quantity); // full price before discount

    // GST rate priority: per-product metafield > Shopify tax_lines > shop default fallback
    const metafieldRateProp = item.properties?.find((p) => p.name === "metafield_gst_rate");
    const metafieldRate = metafieldRateProp ? parseFloat(metafieldRateProp.value) : 0;
    const shopifyRate = item.tax_lines.reduce((sum, t) => sum + t.rate * 100, 0);
    const fallback = (shop.settings as any)?.useDefaultGstRate !== false
      ? (shop.settings?.defaultGstRate ?? 0)
      : 0;
    const gstRate = metafieldRate > 0 ? metafieldRate : (shopifyRate > 0 ? shopifyRate : fallback);

    // PRIMARY: back-calculate taxable from Shopify's actual tax amounts.
    // This is the most reliable method — it correctly handles all discount types
    // (coupon codes, automatic discounts, manual adjustments) because Shopify always
    // computes tax on the discounted amount, so taxLines reflect the real taxable base.
    const shopifyTotalTax = item.tax_lines.reduce((sum, t) => sum + parseFloat(t.price), 0);
    const shopifyTotalRateDecimal = item.tax_lines.reduce((sum, t) => sum + t.rate, 0);

    let taxableValue: number;
    if (shopifyTotalTax > 0 && shopifyTotalRateDecimal > 0) {
      taxableValue = r2(shopifyTotalTax / shopifyTotalRateDecimal);
    } else {
      // Fallback for 0% GST items or items with no tax lines
      const rawDiscount = parseFloat(item.total_discount);
      const lineNetTotal = r2(listTotal - rawDiscount);
      taxableValue = (gstRate > 0 && taxesIncluded)
        ? r2(lineNetTotal / (1 + gstRate / 100))
        : lineNetTotal;
    }

    const taxes = calculateLineTax(taxableValue, gstRate, taxType);
    const totalAmount = r2(taxableValue + taxes.cgstAmount + taxes.sgstAmount + taxes.igstAmount);

    // Discount = use Shopify's total_discount directly when > 0 (exact, no rounding),
    // otherwise infer from list price vs actual paid amount
    const rawDiscount = parseFloat(item.total_discount);
    const itemDiscount = rawDiscount > 0 ? rawDiscount : Math.max(0, taxesIncluded
      ? r2(listTotal - totalAmount)      // taxes-included: MRP - customer paid
      : r2(listTotal - taxableValue));   // taxes-excluded: pre-tax list - pre-tax net

    totalSubtotal += listTotal;
    totalDiscount += itemDiscount;
    totalTaxable += taxableValue;
    totalCgst += taxes.cgstAmount;
    totalSgst += taxes.sgstAmount;
    totalIgst += taxes.igstAmount;

    // Look for HSN in line item properties
    const hsnProp = item.properties?.find((p) => p.name.toLowerCase().includes("hsn"));

    return {
      productName: item.title,
      variantName: item.variant_title || null,
      hsnCode: hsnProp?.value || null,
      quantity: item.quantity,
      unitPrice,
      discount: itemDiscount,
      taxableValue,
      ...taxes,
      totalAmount,
    };
  });

  const lineItemTotal = r2(totalTaxable + totalCgst + totalSgst + totalIgst);

  // Shipping charges
  let shippingAmount = 0;
  let shippingTax = 0;
  for (const sl of order.shipping_lines || []) {
    const slPrice = parseFloat(sl.price);
    shippingAmount = r2(shippingAmount + slPrice);
    const shopifySlTax = (sl.tax_lines || []).reduce((s, t) => s + parseFloat(t.price), 0);
    if (shopifySlTax > 0) {
      shippingTax = r2(shippingTax + shopifySlTax);
    } else if ((shop.settings as any)?.shippingGstEnabled) {
      const rate = (shop.settings as any)?.shippingGstRate ?? 18;
      shippingTax = r2(shippingTax + r2(slPrice * rate / 100));
    }
  }
  const totalAmount = r2(lineItemTotal + shippingAmount + shippingTax);

  // Get buyer GSTIN — check order note_attributes first, then B2B customer DB by email
  const buyerGstinAttr = order.note_attributes?.find(
    (a) => a.name.toLowerCase().includes("gstin")
  );
  let buyerGstin = buyerGstinAttr?.value || null;

  if (!buyerGstin && order.email) {
    const b2bCustomer = await prisma.b2BCustomer.findFirst({
      where: { shopId: shop.id, email: { equals: order.email, mode: "insensitive" } },
      select: { gstin: true },
    });
    if (b2bCustomer) buyerGstin = b2bCustomer.gstin;
  }

  const supplyType = buyerGstin ? "B2B" : "B2C";

  // Choose address source based on useBillingAsShipping setting
  // true (default) = use billing address; false = prefer shipping address for buyerAddress fields
  const useBilling = shop.settings?.useBillingAsShipping !== false;
  const addrSrc = (!useBilling && order.shipping_address) ? order.shipping_address : order.billing_address;

  const invoice = await prisma.invoice.create({
    data: {
      shopId: shop.id,
      orderId,
      orderName: order.name,
      invoiceNumber,
      invoiceType: "TAX_INVOICE",
      supplyType,
      taxType,
      buyerName: [order.billing_address?.first_name, order.billing_address?.last_name].filter(Boolean).join(" ") || null,
      buyerEmail: order.email || null,
      buyerPhone: order.phone || null,
      buyerAddress: addrSrc?.address1 || null,
      buyerCity: addrSrc?.city || null,
      buyerState: addrSrc?.province || null,
      buyerStateCode,
      buyerPincode: addrSrc?.zip || null,
      buyerGstin,
      placeOfSupply: buyerStateCode,
      subTotal: totalSubtotal,
      discountAmount: totalDiscount,
      taxableAmount: totalTaxable,
      cgstAmount: totalCgst,
      sgstAmount: totalSgst,
      igstAmount: totalIgst,
      shippingAmount,
      shippingTax,
      totalAmount,
      orderNote: order.note || null,
      paymentMethod: order.payment_gateway || null,
      orderTags: order.tags || null,
      amountInWords: amountToWords(totalAmount),
      lineItems: {
        create: lineItemsData,
      },
    },
  });

  return invoice.id;
}
