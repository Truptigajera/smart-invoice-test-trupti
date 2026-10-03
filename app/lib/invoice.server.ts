import type { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";
import {
  determineTaxType,
  splitGst,
  getStateCodeFromGstin,
  getIndianStateCode,
  amountToWords,
  isValidGstRate,
  validateGstin,
} from "~/lib/gst";
import { canUseFeature } from "~/lib/plan-features";
import { generateInvoiceNumber } from "~/lib/invoice-number.server";
import { incrementOrderCount, assertCanCreateInvoice } from "~/lib/plan-limits.server";

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
    // Every discount on the line, including its share of order-level discounts (webhook payload)
    discount_allocations?: Array<{ amount: string }>;
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
  order: ShopifyOrder,
  // Set when rebuilding an invoice that already existed: keeps its number (GST numbering must
  // stay gap-free) and doesn't count against the monthly limit a second time.
  opts: {
    reuseInvoiceNumber?: string;
    // Recalculation: keep the original invoice's date, email status and e-invoice details
    keep?: Partial<Pick<Prisma.InvoiceUncheckedCreateInput,
      "invoiceDate" | "createdAt" | "emailSentAt" | "irn" | "irnStatus" | "ackNo" | "ackDate" | "qrCode" | "customFieldValues">>;
  } = {}
): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });

  if (!shop) throw new Error(`Shop not found: ${shopDomain}`);

  const orderId = String(order.id);

  // Check if a tax invoice already exists for this order (credit notes share the orderId)
  const existing = await prisma.invoice.findFirst({
    where: { shopId: shop.id, orderId, invoiceType: { not: "CREDIT_NOTE" } },
  });
  if (existing) return existing.id;

  let invoiceNumber: string;
  if (opts.reuseInvoiceNumber) {
    invoiceNumber = opts.reuseInvoiceNumber;
  } else {
    // Every path that creates a new invoice (webhook, Orders page, Print, bulk) goes through here,
    // so this is the single place the plan limit is enforced. Throws PlanLimitError.
    await assertCanCreateInvoice(shop.id, shop.currentPlan);
    invoiceNumber = await generateInvoiceNumber(shop.id, order.name);
    await incrementOrderCount(shop.id);
  }

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
    // Ignore rates that aren't real GST slabs (e.g. "6" typed for the CGST half of 12%) —
    // fall back to the rate Shopify actually charged instead of printing a wrong one
    const metafieldRate = metafieldRateProp && isValidGstRate(metafieldRateProp.value)
      ? parseFloat(metafieldRateProp.value)
      : 0;
    const shopifyRate = item.tax_lines.reduce((sum, t) => sum + t.rate * 100, 0);
    const fallback = (shop.settings as any)?.useDefaultGstRate !== false
      ? (shop.settings?.defaultGstRate ?? 0)
      : 0;
    const gstRate = metafieldRate > 0 ? metafieldRate : (shopifyRate > 0 ? shopifyRate : fallback);

    // Discount on this line: the larger of the line discount and all allocations
    // (allocations also carry this line's share of order-level discount codes)
    const allocated = (item.discount_allocations || []).reduce((s, d) => s + parseFloat(d.amount), 0);
    const itemDiscount = r2(Math.max(parseFloat(item.total_discount) || 0, allocated));
    // What this line actually costs after discounts — includes GST when prices are GST-inclusive
    const lineNet = r2(listTotal - itemDiscount);

    // Use Shopify's exact tax amount when it was charged at the same rate we invoice at,
    // so the invoice matches the order to the paisa. Otherwise (e.g. a product's GST rate set in
    // the app differs from the store's tax settings) compute GST at our rate from the line amount.
    const shopifyTotalTax = item.tax_lines.reduce((sum, t) => sum + parseFloat(t.price), 0);
    const useShopifyTax = shopifyTotalTax > 0 && Math.abs(shopifyRate - gstRate) < 0.01;

    let taxableValue: number;
    let lineTax: number;
    if (taxesIncluded) {
      // GST is inside lineNet: split it out so taxable + GST = what the customer paid
      lineTax = useShopifyTax ? r2(shopifyTotalTax) : r2(lineNet - lineNet / (1 + gstRate / 100));
      taxableValue = r2(lineNet - lineTax);
    } else {
      // GST is charged on top of lineNet
      taxableValue = lineNet;
      lineTax = useShopifyTax ? r2(shopifyTotalTax) : r2(lineNet * gstRate / 100);
    }

    const taxes = splitGst(lineTax, gstRate, taxType);
    const totalAmount = r2(taxableValue + lineTax);

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
  // shippingAmount is stored as the taxable shipping value, shippingTax as its GST,
  // so shippingAmount + shippingTax is what the customer paid for shipping.
  for (const sl of order.shipping_lines || []) {
    const slPrice = parseFloat(sl.price);
    const shopifySlTax = (sl.tax_lines || []).reduce((s, t) => s + parseFloat(t.price), 0);
    let slTax = 0;
    if (shopifySlTax > 0) {
      slTax = r2(shopifySlTax);
    } else if ((shop.settings as any)?.shippingGstEnabled) {
      const rate = (shop.settings as any)?.shippingGstRate ?? 18;
      slTax = taxesIncluded ? r2(slPrice - slPrice / (1 + rate / 100)) : r2(slPrice * rate / 100);
    }
    // GST-inclusive shipping already contains slTax — take it out instead of adding it on top
    shippingAmount = r2(shippingAmount + (taxesIncluded ? slPrice - slTax : slPrice));
    shippingTax = r2(shippingTax + slTax);
  }
  const totalAmount = r2(lineItemTotal + shippingAmount + shippingTax);

  // Get buyer GSTIN — check order note_attributes first, then B2B customer DB by email
  const buyerGstinAttr = order.note_attributes?.find(
    (a) => a.name.toLowerCase().includes("gstin")
  );
  // A GSTIN typed at checkout is only used if it's genuinely valid (format + checksum)
  const checkoutGstin = (buyerGstinAttr?.value || "").trim().toUpperCase();
  let buyerGstin = validateGstin(checkoutGstin) ? checkoutGstin : null;
  let b2bCompanyName: string | null = null;

  // Saved B2B customers are a Pro feature; entries from the public collection link
  // are skipped until the merchant approves them
  if (!buyerGstin && order.email && canUseFeature(shop.currentPlan, "b2b-customers")) {
    const b2bCustomer = await prisma.b2BCustomer.findFirst({
      where: {
        shopId: shop.id,
        email: { equals: order.email.trim(), mode: "insensitive" },
        pendingApproval: { not: true },
      },
      select: { gstin: true, companyName: true },
    });
    if (b2bCustomer) {
      buyerGstin = b2bCustomer.gstin;
      b2bCompanyName = b2bCustomer.companyName;
    }
  }

  const supplyType = buyerGstin ? "B2B" : "B2C";

  // Choose address source based on useBillingAsShipping setting
  // true (default) = use billing address; false = prefer shipping address for buyerAddress fields
  const useBilling = shop.settings?.useBillingAsShipping !== false;
  const addrSrc = (!useBilling && order.shipping_address) ? order.shipping_address : order.billing_address;

  const invoice = await prisma.invoice.create({
    data: {
      ...opts.keep,
      shopId: shop.id,
      orderId,
      orderName: order.name,
      invoiceNumber,
      invoiceType: "TAX_INVOICE",
      supplyType,
      taxType,
      // A B2B invoice must name the registered business (the GSTIN holder), not the person who ordered
      buyerName: b2bCompanyName
        || [order.billing_address?.first_name, order.billing_address?.last_name].filter(Boolean).join(" ")
        || null,
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
