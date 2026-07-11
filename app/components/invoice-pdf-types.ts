export interface LineItem {
  productName: string;
  variantName: string | null;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxableValue: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface ShopSettings {
  primaryColor: string;
  templateId: string;
  headerText: string | null;
  footerText: string | null;
  showHsnCode: boolean;
  showDiscount: boolean;
  currencySymbol?: string | null;
  dateFormat?: string | null;
}

export interface Shop {
  businessName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  settings: ShopSettings | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string | Date;
  orderName?: string | null;
  invoiceType: string;
  taxType: string;
  supplyType: string;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerCity: string | null;
  buyerState: string | null;
  buyerPincode: string | null;
  buyerGstin: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  subTotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  shippingAmount?: number;
  shippingTax?: number;
  totalAmount: number;
  orderNote?: string | null;
  paymentMethod?: string | null;
  orderTags?: string | null;
  amountInWords: string | null;
  irn: string | null;
  irnStatus: string | null;
  ackNo: string | null;
  ackDate: string | null;
  qrCodeDataUrl: string | undefined;
  shop: Shop;
  lineItems: LineItem[];
}

export type CopyType = "Original" | "Duplicate" | "Triplicate";

export function formatRs(n: number, symbol = "₹"): string {
  return `${symbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(d: string | Date, format = "DD-MM-YYYY"): string {
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  switch (format) {
    case "DD/MM/YYYY": return `${day}/${month}/${year}`;
    case "MMM DD YYYY": return `${monthNames[date.getMonth()]} ${day}, ${year}`;
    default: return `${day}-${month}-${year}`;
  }
}

export function makeFormatters(settings?: ShopSettings | null) {
  const symbol = settings?.currencySymbol || "₹";
  const fmt = settings?.dateFormat || "DD-MM-YYYY";
  return {
    formatRs: (n: number) => formatRs(n, symbol),
    formatDate: (d: string | Date) => formatDate(d, fmt),
  };
}
