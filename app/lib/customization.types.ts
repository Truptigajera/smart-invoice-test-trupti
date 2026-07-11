// Shared types and defaults for TemplateCustomization — used by both the
// customize route (UI) and the PDF templates (rendering).

export interface BrandingSettings {
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}

export interface OverviewSettings {
  showLogo: boolean;
  logoWidth: number;
  showTitle: boolean;
  invoiceTitleLabel: string;
  showSupplierGstin: boolean;
  showQrCode: boolean;
  showPaidWatermark: boolean;
  showInvoiceNumber: boolean;
  invoiceNumberLabel: string;
  showOrderDate: boolean;
  orderDateLabel: string;
  showPlaceOfSupply: boolean;
  placeOfSupplyLabel: string;
  showPaymentGateway: boolean;
  paymentLabel: string;
  showOrderNumber: boolean;
  showDueDate: boolean;
  showTrackingInfo: boolean;
  showOrderTags: boolean;
}

export interface AddressFieldSettings {
  show: boolean;
  showName: boolean;
  showAddress: boolean;
  showCountry: boolean;
  showPhone: boolean;
  showGstin: boolean;
  showEmail: boolean;
  showCompany: boolean;
  showStateCode: boolean;
}

export interface AddressSettings {
  supplier: AddressFieldSettings;
  billing: AddressFieldSettings;
  shipping: AddressFieldSettings;
  fallback: boolean;
}

export interface LineItemsSettings {
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  showProductImage: boolean;
  showSku: boolean;
  showBarcode: boolean;
  barcodeWidth: number;
  showBarcodeValue: boolean;
  showWeight: boolean;
  showVendor: boolean;
  showFulfillmentLocation: boolean;
  showCompareAtPrice: boolean;
  igstLabel: string;
  cgstLabel: string;
  sgstLabel: string;
  showRefundQty: boolean;
  showSummaryRow: boolean;
}

export interface NotesSettings {
  showOrderNotes: boolean;
  orderNoteTitle: string;
  showThankYou: boolean;
  thankYouNote: string;
  showContactEmail: boolean;
  emailPrefixText: string;
  contactEmail: string;
}

export interface TotalsSettings {
  rowOrder: string[];
  rowVisibility: Record<string, boolean>;
  showTotalInWords: boolean;
  showSignature: boolean;
}

export interface FooterSettings {
  hideSocialOnPrint: boolean;
  showWebsite: boolean; websiteLabel: string; websiteUrl: string;
  showFacebook: boolean; facebookLabel: string; facebookUrl: string;
  showInstagram: boolean; instagramLabel: string; instagramUrl: string;
  showX: boolean; xLabel: string; xUrl: string;
  showFooterNotes: boolean; footerNotes: string;
  showDisclaimer: boolean;
}

export interface LabelsSettings {
  invoiceTitle: string;
  gstin: string;
  taxInvoiceTitle: string;
  billTo: string;
  shipTo: string;
  supplier: string;
  orderNoteTitle: string;
  totalInWordsLabel: string;
}

export interface TemplateCustomizationSettings {
  branding: BrandingSettings;
  overview: OverviewSettings;
  address: AddressSettings;
  lineItems: LineItemsSettings;
  notes: NotesSettings;
  totals: TotalsSettings;
  footer: FooterSettings;
  labels: LabelsSettings;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_BRANDING: BrandingSettings = {
  fontFamily: "NotoSans",
  headingSize: 13,
  bodySize: 9,
};

export const DEFAULT_OVERVIEW: OverviewSettings = {
  showLogo: true, logoWidth: 80, showTitle: true, invoiceTitleLabel: "Tax Invoice",
  showSupplierGstin: true, showQrCode: false, showPaidWatermark: true,
  showInvoiceNumber: true, invoiceNumberLabel: "Invoice No.",
  showOrderDate: true, orderDateLabel: "Order Date",
  showPlaceOfSupply: true, placeOfSupplyLabel: "Place of Supply",
  showPaymentGateway: false, paymentLabel: "Payment",
  showOrderNumber: true, showDueDate: false, showTrackingInfo: false, showOrderTags: false,
};

export const DEFAULT_ADDRESS_FIELD: AddressFieldSettings = {
  show: true, showName: true, showAddress: true, showCountry: false,
  showPhone: true, showGstin: true, showEmail: true, showCompany: true, showStateCode: true,
};

export const DEFAULT_ADDRESS: AddressSettings = {
  supplier: { ...DEFAULT_ADDRESS_FIELD },
  billing: { ...DEFAULT_ADDRESS_FIELD },
  shipping: { ...DEFAULT_ADDRESS_FIELD },
  fallback: true,
};

export const DEFAULT_LINE_ITEMS: LineItemsSettings = {
  columnOrder: ["description", "qty", "unitPrice", "hsCode", "taxableValue", "gst", "totalTax", "total"],
  columnVisibility: {
    description: true, qty: true, unitPrice: true, hsCode: true,
    taxableValue: true, gst: true, taxRates: true, totalTax: true,
    taxAmount: false, total: true, discount: true,
  },
  showProductImage: false, showSku: false, showBarcode: false, barcodeWidth: 100,
  showBarcodeValue: false, showWeight: false, showVendor: false,
  showFulfillmentLocation: false, showCompareAtPrice: true,
  igstLabel: "IGST", cgstLabel: "CGST", sgstLabel: "SGST",
  showRefundQty: false, showSummaryRow: true,
};

export const DEFAULT_NOTES: NotesSettings = {
  showOrderNotes: true, orderNoteTitle: "Order Note",
  showThankYou: false, thankYouNote: "",
  showContactEmail: true, emailPrefixText: "If you have any questions, please do get in contact at",
  contactEmail: "",
};

export const DEFAULT_TOTALS: TotalsSettings = {
  rowOrder: ["discount", "beforeTax", "totalTax", "afterTax", "shippingAmount", "shippingTax", "shippingTotal", "grandTotal"],
  rowVisibility: {
    discount: true, beforeTax: true, totalTax: true, afterTax: true,
    shippingAmount: true, shippingTax: true, shippingTotal: true, grandTotal: true,
    shippingHsn: false, totalRefunded: false, outstanding: false,
    roundOff: true,
  },
  showTotalInWords: true,
  showSignature: true,
};

export const DEFAULT_FOOTER: FooterSettings = {
  hideSocialOnPrint: false,
  showWebsite: false, websiteLabel: "", websiteUrl: "",
  showFacebook: true, facebookLabel: "facebook", facebookUrl: "",
  showInstagram: true, instagramLabel: "instagram", instagramUrl: "",
  showX: true, xLabel: "X", xUrl: "",
  showFooterNotes: false, footerNotes: "",
  showDisclaimer: false,
};

export const DEFAULT_LABELS: LabelsSettings = {
  invoiceTitle: "Tax Invoice", gstin: "GSTIN:", taxInvoiceTitle: "TAX INVOICE",
  billTo: "Billed To", shipTo: "Ship To", supplier: "Supplier",
  orderNoteTitle: "Order Note", totalInWordsLabel: "",
};

export const DEFAULT_CUSTOMIZATION: TemplateCustomizationSettings = {
  branding: DEFAULT_BRANDING,
  overview: DEFAULT_OVERVIEW,
  address: DEFAULT_ADDRESS,
  lineItems: DEFAULT_LINE_ITEMS,
  notes: DEFAULT_NOTES,
  totals: DEFAULT_TOTALS,
  footer: DEFAULT_FOOTER,
  labels: DEFAULT_LABELS,
};

export function mergeDefaults<T extends object>(saved: Partial<T> | null | undefined, defaults: T): T {
  if (!saved) return defaults;
  return { ...defaults, ...saved } as T;
}

export function mergeCustomization(
  saved: Partial<{
    branding: unknown; overview: unknown; address: unknown;
    lineItems: unknown; notes: unknown; totals: unknown;
    footer: unknown; labels: unknown;
  }> | null
): TemplateCustomizationSettings {
  if (!saved) return DEFAULT_CUSTOMIZATION;
  return {
    branding: { ...DEFAULT_BRANDING, ...(saved.branding as Partial<BrandingSettings> ?? {}) },
    overview: { ...DEFAULT_OVERVIEW, ...(saved.overview as Partial<OverviewSettings> ?? {}) },
    address: { ...DEFAULT_ADDRESS, ...(saved.address as Partial<AddressSettings> ?? {}) },
    lineItems: { ...DEFAULT_LINE_ITEMS, ...(saved.lineItems as Partial<LineItemsSettings> ?? {}) },
    notes: { ...DEFAULT_NOTES, ...(saved.notes as Partial<NotesSettings> ?? {}) },
    totals: { ...DEFAULT_TOTALS, ...(saved.totals as Partial<TotalsSettings> ?? {}) },
    footer: { ...DEFAULT_FOOTER, ...(saved.footer as Partial<FooterSettings> ?? {}) },
    labels: { ...DEFAULT_LABELS, ...(saved.labels as Partial<LabelsSettings> ?? {}) },
  };
}
