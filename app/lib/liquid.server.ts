import { Liquid } from "liquidjs";
import type { InvoiceData } from "~/components/invoice-pdf-types";
import { formatDate, formatRs } from "~/components/invoice-pdf-types";

// ─── LiquidJS Engine Factory ──────────────────────────────────────────────────
// Creates a fresh engine per render so money/date filters respect shop settings.

function buildEngine(currencySymbol = "₹", dateFormat = "DD-MM-YYYY") {
  const eng = new Liquid({ strictFilters: false, strictVariables: false });

  eng.registerFilter("money", (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v)) || 0;
    return formatRs(n, currencySymbol);
  });

  eng.registerFilter("rs", (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v)) || 0;
    return `Rs. ${n.toFixed(2)}`;
  });

  eng.registerFilter("date_fmt", (v: unknown) => {
    if (!v) return "";
    return formatDate(String(v), dateFormat);
  });

  eng.registerFilter("amount_in_words", (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v)) || 0;
    return amountInWords(n);
  });

  eng.registerFilter("barcode", async (value: unknown, ...args: unknown[]) => {
    if (!value) return "";
    try {
      const bwipjs = await import("bwip-js");
      const opts = parseFilterArgs(args);
      const png = await (bwipjs as any).toBuffer({
        bcid: "code128",
        text: String(value),
        scale: 2,
        height: typeof opts.height === "number" ? opts.height / 10 : 8,
        includetext: opts.displayValue !== false,
      });
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return "";
    }
  });

  eng.registerFilter("qr", async (value: unknown, ...args: unknown[]) => {
    if (!value) return "";
    try {
      const QRCode = (await import("qrcode")).default;
      const opts = parseFilterArgs(args);
      const size = typeof opts.width === "number" ? opts.width : 200;
      const url = await QRCode.toDataURL(String(value), { width: size, margin: 1 });
      return url;
    } catch {
      return "";
    }
  });

  return eng;
}

function parseFilterArgs(args: unknown[]): Record<string, unknown> {
  const last = args[args.length - 1];
  if (last && typeof last === "object" && !Array.isArray(last)) return last as Record<string, unknown>;
  return {};
}

// ─── Template Renderer ────────────────────────────────────────────────────────

export async function renderLiquidTemplate(
  template: string,
  scope: Record<string, unknown>,
  settings?: { currencySymbol?: string | null; dateFormat?: string | null }
): Promise<string> {
  const symbol = settings?.currencySymbol || (scope as any)?.settings?.currencySymbol || "₹";
  const fmt = settings?.dateFormat || (scope as any)?.settings?.dateFormat || "DD-MM-YYYY";
  const eng = buildEngine(symbol, fmt);
  return eng.parseAndRender(template, scope);
}

// ─── Invoice → Liquid Scope ───────────────────────────────────────────────────

export function invoiceToScope(
  invoice: InvoiceData,
  copyType: string = "Original"
): Record<string, unknown> {
  const { shop, lineItems } = invoice;
  const s = shop.settings;
  const isIGST = invoice.taxType === "IGST";
  const inv = invoice as any;
  const dateFormat = (s as any)?.dateFormat || "DD-MM-YYYY";

  const lineItemsScope = lineItems.map((item, i) => {
    const li = item as any;
    return {
      index: i + 1,
      name: item.productName,
      variantName: item.variantName || "",
      sku: li.sku || "",
      hsn: item.hsnCode || "N/A",
      quantity: item.quantity,
      unit: item.unit || "Nos",
      unitPrice: item.unitPrice,
      taxable: item.taxableValue,
      gstPct: isIGST ? item.igstRate : (item.cgstRate || 0) * 2,
      cgstRate: item.cgstRate || 0,
      cgstAmt: item.cgstAmount || 0,
      sgstRate: item.sgstRate || 0,
      sgstAmt: item.sgstAmount || 0,
      igstRate: item.igstRate || 0,
      igstAmt: item.igstAmount || 0,
      total: item.totalAmount,
    };
  });

  return {
    shop: {
      name: shop.businessName || "",
      gstin: shop.gstin || "",
      address: shop.address || "",
      city: shop.city || "",
      state: shop.state || "",
      pincode: shop.pincode || "",
      country: "India",
      phone: shop.phone || "",
      email: shop.email || "",
      logoUrl: shop.logoUrl || "",
      signatureUrl: shop.signatureUrl || "",
      footerText: s?.footerText || "Thank you for your business!",
    },
    invoice: {
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      dateFormatted: formatDate(invoice.invoiceDate, dateFormat),
      type: invoice.invoiceType,
      copyType,
      supplyType: invoice.supplyType,
      taxType: invoice.taxType,
      isIGST,
      placeOfSupply: invoice.placeOfSupply || invoice.buyerState || "",
      reverseCharge: invoice.reverseCharge || false,
      amountInWords: invoice.amountInWords || "",
      orderName: inv.orderName || invoice.orderName || "",
    },
    buyer: {
      name: invoice.buyerName || "",
      company: inv.buyerCompany || "",
      address: invoice.buyerAddress || "",
      city: invoice.buyerCity || "",
      state: invoice.buyerState || "",
      pincode: invoice.buyerPincode || "",
      country: inv.buyerCountry || "India",
      phone: invoice.buyerPhone || "",
      email: invoice.buyerEmail || "",
      gstin: invoice.buyerGstin || "",
    },
    shipping: {
      name: inv.shippingName || invoice.buyerName || "",
      address: inv.shippingAddress || invoice.buyerAddress || "",
      city: inv.shippingCity || invoice.buyerCity || "",
      state: inv.shippingState || invoice.buyerState || "",
      pincode: inv.shippingPincode || invoice.buyerPincode || "",
      country: "India",
      phone: inv.shippingPhone || invoice.buyerPhone || "",
    },
    lineItems: lineItemsScope,
    totals: {
      subtotal: invoice.subTotal,
      discount: invoice.discountAmount,
      taxable: invoice.taxableAmount,
      cgst: invoice.cgstAmount,
      sgst: invoice.sgstAmount,
      igst: invoice.igstAmount,
      tax: invoice.cgstAmount + invoice.sgstAmount + invoice.igstAmount,
      shipping: inv.shippingAmount || 0,
      shippingTax: inv.shippingTax || 0,
      grandTotal: invoice.totalAmount,
      totalRefunded: inv.totalRefunded || 0,
      outstanding: inv.totalOutstanding || 0,
    },
    settings: {
      dateFormat: (s as any)?.dateFormat || "DD-MM-YYYY",
      currencySymbol: (s as any)?.currencySymbol || "₹",
      showHsn: s?.showHsnCode !== false,
      shippingHsn: (s as any)?.shippingHsnCode || "996812",
    },
  };
}

// ─── Amount in Words ──────────────────────────────────────────────────────────

function amountInWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function words(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred " + words(n % 100);
    if (n < 100000) return words(Math.floor(n / 1000)) + "Thousand " + words(n % 1000);
    if (n < 10000000) return words(Math.floor(n / 100000)) + "Lakh " + words(n % 100000);
    return words(Math.floor(n / 10000000)) + "Crore " + words(n % 10000000);
  }

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let result = words(rupees).trim() + " Rupees";
  if (paise > 0) result += " and " + words(paise).trim() + " Paise";
  return result + " Only";
}

// ─── Default Starter Template (defined in ~/lib/template-defaults.ts) ─────────

export { DEFAULT_HTML_TEMPLATE } from "~/lib/template-defaults";
