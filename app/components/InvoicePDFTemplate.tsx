import {
  Document, Page, View, Text, StyleSheet, Image,
} from "@react-pdf/renderer";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";

// Types (matching Prisma output with includes)
interface LineItem {
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

interface ShopSettings {
  primaryColor: string;
  templateId: string;
  headerText: string | null;
  footerText: string | null;
  showHsnCode: boolean;
  showDiscount: boolean;
}

interface Shop {
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

interface Invoice {
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
  orderNote?: string | null;
  paymentMethod?: string | null;
  orderTags?: string | null;
  totalAmount: number;
  amountInWords: string | null;
  irn: string | null;
  irnStatus: string | null;
  ackNo: string | null;
  ackDate: string | null;
  qrCodeDataUrl: string | undefined;
  shop: Shop;
  lineItems: LineItem[];
}

const PRIMARY = "#1a73e8";

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: {
    fontFamily: base,
    fontSize: bodySize,
    color: "#222",
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 30,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: `2px solid ${PRIMARY}`,
  },
  headerLeft: { flex: 1 },
  logo: { width: 80, height: 40, objectFit: "contain", marginBottom: 4 },
  companyName: { fontSize: headingSize + 1, fontFamily: bold, color: PRIMARY },
  companyDetail: { fontSize: 8, color: "#555", marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  invoiceTitle: { fontSize: 18, fontFamily: bold, color: PRIMARY },
  invoiceNumber: { fontSize: 9, color: "#333", marginTop: 4 },
  invoiceDate: { fontSize: 8, color: "#555", marginTop: 2 },
  badge: {
    marginTop: 6,
    backgroundColor: PRIMARY,
    color: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 7,
    fontFamily: bold,
  },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  colBox: {
    flex: 1,
    borderRadius: 4,
    border: "1px solid #e0e0e0",
    padding: 8,
  },
  colTitle: {
    fontSize: 7,
    fontFamily: bold,
    color: PRIMARY,
    textTransform: "uppercase",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  colValue: { fontSize: 8.5, fontFamily: bold, marginBottom: 2 },
  colDetail: { fontSize: 8, color: "#555", marginBottom: 1 },
  table: { marginBottom: 10 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: PRIMARY,
    color: "#fff",
    padding: "4 4",
  },
  tableRow: {
    flexDirection: "row",
    padding: "4 4",
    borderBottom: "1px solid #f0f0f0",
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: "4 4",
    backgroundColor: "#f8f9ff",
    borderBottom: "1px solid #f0f0f0",
  },
  thSno: { width: "4%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold },
  thItem: { width: "28%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold },
  thHsn: { width: "8%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold },
  thQty: { width: "6%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  thRate: { width: "10%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  thTaxable: { width: "10%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  thTax: { width: "8%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  thAmount: { width: "10%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  tdSno: { width: "4%", fontSize: bodySize - 1 },
  tdItem: { width: "28%", fontSize: bodySize - 1 },
  tdHsn: { width: "8%", fontSize: bodySize - 1, color: "#555" },
  tdQty: { width: "6%", fontSize: bodySize - 1, textAlign: "right" },
  tdRate: { width: "10%", fontSize: bodySize - 1, textAlign: "right" },
  tdTaxable: { width: "10%", fontSize: bodySize - 1, textAlign: "right" },
  tdTax: { width: "8%", fontSize: bodySize - 1, textAlign: "right", color: "#555" },
  tdAmount: { width: "10%", fontSize: bodySize - 1, textAlign: "right", fontFamily: bold },
  thDiscount: { width: "8%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  thGstRate: { width: "6%", color: "#fff", fontSize: bodySize - 2, fontFamily: bold, textAlign: "right" },
  tdDiscount: { width: "8%", fontSize: bodySize - 1, textAlign: "right" },
  tdGstRate: { width: "6%", fontSize: bodySize - 1, textAlign: "right", color: "#555" },
  totalsSection: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  totalsBox: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: "3 4" },
  totalRowBorder: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "3 4",
    borderTop: "1px solid #e0e0e0",
  },
  totalLabel: { fontSize: 8, color: "#555" },
  totalValue: { fontSize: 8 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: PRIMARY,
    padding: "5 4",
    borderRadius: 2,
    marginTop: 2,
  },
  grandTotalLabel: { fontSize: 9, fontFamily: bold, color: "#fff" },
  grandTotalValue: { fontSize: 9, fontFamily: bold, color: "#fff" },
  amountWords: {
    fontSize: 8,
    fontFamily: boldItalic,
    color: "#333",
    backgroundColor: "#f5f5f5",
    padding: 6,
    borderRadius: 3,
    marginBottom: 12,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    borderTop: "1px solid #e0e0e0",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: "#888" },
  noteBox: {
    backgroundColor: "#f9f9f9",
    border: "1px solid #e8e8e8",
    borderRadius: 3,
    padding: 8,
    marginBottom: 10,
  },
  noteTitle: { fontSize: 7.5, fontFamily: bold, color: "#333", marginBottom: 3 },
  noteText: { fontSize: 8, color: "#555" },
});

export function InvoicePDFTemplate({
  invoice,
  copyType = "Original",
  customization,
}: {
  invoice: Invoice;
  copyType?: "Original" | "Duplicate" | "Triplicate";
  customization?: TemplateCustomizationSettings;
}) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const styles = makeStyles(fonts.base, fonts.bold, fonts.boldItalic, cx.branding.bodySize, cx.branding.headingSize);
  const { shop, lineItems } = invoice;
  const settings = shop.settings;
  const { formatDate, formatRs } = makeFormatters(settings);
  const isIGST = invoice.taxType === "IGST";

  // Derived flags from customization
  const showHsn = cx.lineItems.columnVisibility.hsCode !== false &&
    settings?.showHsnCode !== false;
  const showDiscount = cx.lineItems.columnVisibility.discount !== false &&
    invoice.discountAmount > 0;
  const showGstRate = cx.lineItems.columnVisibility.taxRates !== false;
  const showLogo = cx.overview.showLogo && !!shop.logoUrl;
  const showSupplierGstin = cx.overview.showSupplierGstin && !!shop.gstin;
  const showBilling = cx.address.billing.show;
  const showTotalInWords = cx.totals.showTotalInWords && !!invoice.amountInWords;
  const showSignature = cx.totals.showSignature && !!shop.signatureUrl;
  const rv = cx.totals.rowVisibility;
  const roundOffAmt = rv.roundOff !== false ? Math.round(invoice.totalAmount) - invoice.totalAmount : 0;
  const showRoundOff = rv.roundOff !== false && Math.abs(roundOffAmt) >= 0.005;
  const grandTotalDisplay = showRoundOff ? Math.round(invoice.totalAmount) : invoice.totalAmount;
  const igstLabel = cx.lineItems.igstLabel || "IGST";
  const cgstLabel = cx.lineItems.cgstLabel || "CGST";
  const sgstLabel = cx.lineItems.sgstLabel || "SGST";
  const labels = cx.labels;

  const titleText = invoice.invoiceType === "CREDIT_NOTE"
    ? "CREDIT NOTE"
    : (cx.overview.invoiceTitleLabel || labels.taxInvoiceTitle || "TAX INVOICE");

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {showLogo && (
              <Image
                src={shop.logoUrl!}
                style={{ ...styles.logo, width: cx.overview.logoWidth || 80 }}
              />
            )}
            <Text style={styles.companyName}>{shop.businessName || "Business Name"}</Text>
            {showSupplierGstin && (
              <Text style={styles.companyDetail}>{labels.gstin || "GSTIN:"} {shop.gstin}</Text>
            )}
            {(cx.address.supplier.show && cx.address.supplier.showAddress && shop.address) ? (
              <Text style={styles.companyDetail}>{shop.address}</Text>
            ) : null}
            {(cx.address.supplier.show && (shop.city || shop.state)) ? (
              <Text style={styles.companyDetail}>
                {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {(cx.address.supplier.show && cx.address.supplier.showPhone && shop.phone) ? (
              <Text style={styles.companyDetail}>Ph: {shop.phone}</Text>
            ) : null}
            {(cx.address.supplier.show && cx.address.supplier.showEmail && shop.email) ? (
              <Text style={styles.companyDetail}>{shop.email}</Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            {cx.overview.showTitle && (
              <Text style={styles.invoiceTitle}>{titleText}</Text>
            )}
            <Text style={{ fontSize: 8, color: "#888", textAlign: "right", marginTop: 2 }}>
              {copyType}
            </Text>
            {cx.overview.showInvoiceNumber && (
              <Text style={styles.invoiceNumber}>
                {cx.overview.invoiceNumberLabel || "Invoice No."}: #{invoice.invoiceNumber}
              </Text>
            )}
            {cx.overview.showOrderNumber && invoice.orderName && (
              <Text style={styles.invoiceDate}>
                Order No.: {invoice.orderName}
              </Text>
            )}
            {cx.overview.showOrderDate && (
              <Text style={styles.invoiceDate}>
                {cx.overview.orderDateLabel || "Order Date"}: {formatDate(invoice.invoiceDate)}
              </Text>
            )}
            <Text style={styles.badge}>{invoice.supplyType} · {isIGST ? "IGST" : "CGST+SGST"}</Text>
          </View>
        </View>

        {/* Address Columns */}
        <View style={styles.twoCol}>
          {showBilling && (
            <View style={styles.colBox}>
              <Text style={styles.colTitle}>{labels.billTo || "Billed To"}</Text>
              {cx.address.billing.showName && (
                <Text style={styles.colValue}>{invoice.buyerName || "Customer"}</Text>
              )}
              {(cx.address.billing.showAddress && invoice.buyerAddress) ? (
                <Text style={styles.colDetail}>{invoice.buyerAddress}</Text>
              ) : null}
              {(invoice.buyerCity || invoice.buyerState) ? (
                <Text style={styles.colDetail}>
                  {[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}
                </Text>
              ) : null}
              {(cx.address.billing.showGstin && invoice.buyerGstin) ? (
                <Text style={styles.colDetail}>GSTIN: {invoice.buyerGstin}</Text>
              ) : null}
              {(cx.address.billing.showPhone && invoice.buyerPhone) ? (
                <Text style={styles.colDetail}>Ph: {invoice.buyerPhone}</Text>
              ) : null}
              {(cx.address.billing.showEmail && invoice.buyerEmail) ? (
                <Text style={styles.colDetail}>{invoice.buyerEmail}</Text>
              ) : null}
            </View>
          )}
          <View style={styles.colBox}>
            <Text style={styles.colTitle}>Invoice Details</Text>
            {cx.overview.showPlaceOfSupply && (
              <Text style={styles.colDetail}>
                {cx.overview.placeOfSupplyLabel || "Place of Supply"}: {invoice.placeOfSupply || invoice.buyerState || "-"}
              </Text>
            )}
            <Text style={styles.colDetail}>
              Tax Type: {isIGST ? "IGST (Inter-state)" : "CGST + SGST (Intra-state)"}
            </Text>
            <Text style={styles.colDetail}>
              Supply: {invoice.supplyType === "B2B" ? "B2B (Registered)" : "B2C (Unregistered)"}
            </Text>
            {invoice.reverseCharge && (
              <Text style={[styles.colDetail, { color: "#e53935" }]}>⚠ Reverse Charge Applicable</Text>
            )}
            {(cx.overview.showPaymentGateway && invoice.paymentMethod) ? (
              <Text style={styles.colDetail}>{cx.overview.paymentLabel || "Payment"}: {invoice.paymentMethod}</Text>
            ) : null}
            {(cx.overview.showOrderTags && invoice.orderTags) ? (
              <Text style={styles.colDetail}>Tags: {invoice.orderTags}</Text>
            ) : null}
            {invoice.irn ? (
              <Text style={styles.colDetail}>IRN: {invoice.irn.substring(0, 20)}...</Text>
            ) : null}
          </View>
        </View>

        {renderCustomFields(invoice, fonts.base, fonts.bold)}

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.thSno}>#</Text>
            <Text style={styles.thItem}>Item</Text>
            {showHsn && <Text style={styles.thHsn}>HSN</Text>}
            <Text style={styles.thQty}>Qty</Text>
            <Text style={styles.thRate}>Rate</Text>
            {showDiscount && <Text style={styles.thDiscount}>Disc.</Text>}
            <Text style={styles.thTaxable}>Taxable</Text>
            {showGstRate && <Text style={styles.thGstRate}>GST%</Text>}
            {isIGST ? (
              <Text style={{ ...styles.thTax, width: "16%" }}>{igstLabel}</Text>
            ) : (
              <>
                <Text style={styles.thTax}>{cgstLabel}</Text>
                <Text style={styles.thTax}>{sgstLabel}</Text>
              </>
            )}
            <Text style={styles.thAmount}>Total</Text>
          </View>

          {lineItems.map((item, i) => (
            <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={styles.tdSno}>{i + 1}</Text>
              <View style={{ width: "28%" }}>
                <Text style={{ fontSize: 8 }}>{item.productName}</Text>
                {item.variantName ? <Text style={{ fontSize: 7, color: "#888" }}>{item.variantName}</Text> : null}
                {cx.lineItems.showSku && item.variantName && (
                  <Text style={{ fontSize: 7, color: "#aaa" }}>SKU: {item.variantName}</Text>
                )}
              </View>
              {showHsn && <Text style={styles.tdHsn}>{item.hsnCode || "-"}</Text>}
              <View style={{ width: "6%", alignItems: "flex-end" }}>
                <Text style={{ fontSize: cx.branding.bodySize - 1 }}>{item.quantity}</Text>
                {item.unit ? <Text style={{ fontSize: 6, color: "#888" }}>{item.unit}</Text> : null}
              </View>
              <Text style={styles.tdRate}>{formatRs(item.unitPrice)}</Text>
              {showDiscount && <Text style={styles.tdDiscount}>{item.discount > 0 ? formatRs(item.discount) : "-"}</Text>}
              <Text style={styles.tdTaxable}>{formatRs(item.taxableValue)}</Text>
              {showGstRate && <Text style={styles.tdGstRate}>{isIGST ? item.igstRate : (item.cgstRate + item.sgstRate)}%</Text>}
              {isIGST ? (
                <Text style={{ ...styles.tdTax, width: "16%" }}>
                  {showGstRate ? formatRs(item.igstAmount) : `${item.igstRate}%\n${formatRs(item.igstAmount)}`}
                </Text>
              ) : (
                <>
                  <Text style={styles.tdTax}>{showGstRate ? formatRs(item.cgstAmount) : `${item.cgstRate}%\n${formatRs(item.cgstAmount)}`}</Text>
                  <Text style={styles.tdTax}>{showGstRate ? formatRs(item.sgstAmount) : `${item.sgstRate}%\n${formatRs(item.sgstAmount)}`}</Text>
                </>
              )}
              <Text style={styles.tdAmount}>{formatRs(item.totalAmount)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatRs(invoice.subTotal)}</Text>
            </View>
            {(showDiscount && rv.discount !== false) ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={styles.totalValue}>- {formatRs(invoice.discountAmount)}</Text>
              </View>
            ) : null}
            {rv.beforeTax !== false ? (
              <View style={styles.totalRowBorder}>
                <Text style={styles.totalLabel}>Taxable Amount</Text>
                <Text style={styles.totalValue}>{formatRs(invoice.taxableAmount)}</Text>
              </View>
            ) : null}
            {isIGST ? (
              rv.totalTax !== false ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{igstLabel}</Text>
                  <Text style={styles.totalValue}>{formatRs(invoice.igstAmount)}</Text>
                </View>
              ) : null
            ) : (
              rv.totalTax !== false ? (
                <>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{cgstLabel}</Text>
                    <Text style={styles.totalValue}>{formatRs(invoice.cgstAmount)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{sgstLabel}</Text>
                    <Text style={styles.totalValue}>{formatRs(invoice.sgstAmount)}</Text>
                  </View>
                </>
              ) : null
            )}
            {(rv.shippingAmount !== false && (invoice.shippingAmount ?? 0) > 0) ? (
              <View style={styles.totalRowBorder}>
                <Text style={styles.totalLabel}>Shipping</Text>
                <Text style={styles.totalValue}>{formatRs(invoice.shippingAmount!)}</Text>
              </View>
            ) : null}
            {(rv.shippingTax !== false && (invoice.shippingTax ?? 0) > 0) ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Shipping GST</Text>
                <Text style={styles.totalValue}>{formatRs(invoice.shippingTax!)}</Text>
              </View>
            ) : null}
            {showRoundOff ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Round Off</Text>
                <Text style={styles.totalValue}>{roundOffAmt >= 0 ? `+${formatRs(roundOffAmt)}` : `-${formatRs(Math.abs(roundOffAmt))}`}</Text>
              </View>
            ) : null}
            {rv.grandTotal !== false ? (
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Grand Total</Text>
                <Text style={styles.grandTotalValue}>{formatRs(grandTotalDisplay)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Amount in Words */}
        {showTotalInWords && (
          <Text style={styles.amountWords}>
            {cx.labels.totalInWordsLabel || "In Words"}: {invoice.amountInWords}
          </Text>
        )}

        {/* Order Notes */}
        {(cx.notes.showOrderNotes && invoice.orderNote) ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteTitle}>{cx.notes.orderNoteTitle || "Order Note"}</Text>
            <Text style={styles.noteText}>{invoice.orderNote}</Text>
          </View>
        ) : null}

        {(cx.footer.showFooterNotes && cx.footer.footerNotes) ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>{cx.footer.footerNotes}</Text>
          </View>
        ) : null}

        {/* Thank You Note */}
        {(cx.notes.showThankYou && cx.notes.thankYouNote) ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>{cx.notes.thankYouNote}</Text>
          </View>
        ) : null}

        {/* Contact Email */}
        {(cx.notes.showContactEmail && cx.notes.contactEmail) ? (
          <Text style={{ fontSize: 8, color: "#555", marginBottom: 8 }}>
            {cx.notes.emailPrefixText} {cx.notes.contactEmail}
          </Text>
        ) : null}

        {(cx.footer.showWebsite || cx.footer.showFacebook || cx.footer.showInstagram || cx.footer.showX) ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
            {cx.footer.showWebsite && cx.footer.websiteUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>{cx.footer.websiteLabel || "Website"}: {cx.footer.websiteUrl}</Text> : null}
            {cx.footer.showFacebook && cx.footer.facebookUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>Facebook: {cx.footer.facebookUrl}</Text> : null}
            {cx.footer.showInstagram && cx.footer.instagramUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>Instagram: {cx.footer.instagramUrl}</Text> : null}
            {cx.footer.showX && cx.footer.xUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>X: {cx.footer.xUrl}</Text> : null}
          </View>
        ) : null}

        {/* Signature */}
        {showSignature && (
          <View style={{ alignItems: "flex-end", marginBottom: 20 }}>
            {shop.businessName ? <Text style={{ fontSize: 7.5, color: "#555", marginBottom: 4 }}>For {shop.businessName}</Text> : null}
            <Image src={shop.signatureUrl!} style={{ width: 100, height: 36, objectFit: "contain" }} />
            <Text style={{ fontSize: 7.5, color: "#555", marginTop: 3 }}>Authorized Signatory</Text>
          </View>
        )}

        {/* E-Invoice IRN + QR Code */}
        {invoice.irn && invoice.irnStatus === "GENERATED" && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderTop: "0.5px solid #DDD", paddingTop: 8, marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 7, color: "#888", marginBottom: 2 }}>E-INVOICE</Text>
              <Text style={{ fontSize: 7, color: "#333", marginBottom: 1 }}>IRN: {invoice.irn}</Text>
              {invoice.ackNo   && <Text style={{ fontSize: 7, color: "#555" }}>ACK No: {invoice.ackNo}</Text>}
              {invoice.ackDate && <Text style={{ fontSize: 7, color: "#555" }}>ACK Date: {invoice.ackDate}</Text>}
            </View>
            {cx.overview.showQrCode && invoice.qrCodeDataUrl && (
              <Image src={invoice.qrCodeDataUrl} style={{ width: 60, height: 60 }} />
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {cx.footer.showFooterNotes && cx.footer.footerNotes
              ? cx.footer.footerNotes
              : "Thank you for your business! This is a computer-generated invoice."}
          </Text>
          <Text style={styles.footerText}>
            {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
