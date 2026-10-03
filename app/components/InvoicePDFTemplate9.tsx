import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { InvoiceData, CopyType } from "./invoice-pdf-types";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";
import { placeOfSupplyText, stateCodeText, reverseChargeText } from "~/lib/pdf-helpers";

// Harvest — golden/amber headers, shop name large top-left, thank-you footer
const C = "#C8920A";
const AMBER = "#F9F1DC";
const AMBER2 = "#FFF8E8";

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: { fontFamily: base, fontSize: bodySize, color: "#1A1A1A", paddingTop: 24, paddingBottom: 40, paddingHorizontal: 28 },
  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  shopName: { fontSize: headingSize + 2, fontFamily: bold, color: "#1A1A1A" },
  shopDetail: { fontSize: 7.5, color: "#666", marginTop: 2 },
  invoiceTitle: { fontSize: headingSize + 4, fontFamily: bold, color: "#1A1A1A", textAlign: "center", flex: 1 },
  copyTypeBadge: { fontSize: headingSize, fontFamily: bold, color: "#1A1A1A", textAlign: "right" },
  logo: { width: 64, height: 32, objectFit: "contain" },
  // Two-column meta section
  metaSection: { flexDirection: "row", gap: 12, marginBottom: 12 },
  metaLeft: { flex: 1 },
  metaRight: { flex: 1 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { fontSize: 7.5, color: "#888", width: 100 },
  metaValue: { fontSize: 7.5, color: "#1A1A1A", fontFamily: bold, flex: 1 },
  supplierTitle: { fontSize: 8.5, fontFamily: bold, color: "#1A1A1A", marginBottom: 3 },
  supplierDetail: { fontSize: 7.5, color: "#555", marginBottom: 2 },
  // Address section
  addressSection: { flexDirection: "row", gap: 12, marginBottom: 12 },
  addressBox: { flex: 1, borderTop: `2px solid ${C}`, paddingTop: 6 },
  addressTitle: { fontSize: 7.5, fontFamily: bold, color: C, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  addressName: { fontSize: 8.5, fontFamily: bold, marginBottom: 2 },
  addressDetail: { fontSize: 7.5, color: "#555", marginBottom: 1 },
  // Line items table
  table: { marginBottom: 10 },
  tableHead: { flexDirection: "row", backgroundColor: C, padding: "5 4" },
  tableRow: { flexDirection: "row", padding: "4 4", borderBottom: `0.5px solid #E8D8A0` },
  tableRowAlt: { flexDirection: "row", padding: "4 4", backgroundColor: AMBER2, borderBottom: `0.5px solid #E8D8A0` },
  tableTotRow: { flexDirection: "row", padding: "4 4", backgroundColor: AMBER, borderTop: `1px solid ${C}` },
  th: { color: "#fff", fontSize: 7, fontFamily: bold },
  td: { fontSize: 7.5 },
  wSno: { width: "4%" },
  wItem: { width: "28%" },
  wHsn: { width: "7%", textAlign: "right" as const },
  wQty: { width: "5%", textAlign: "right" as const },
  wRate: { width: "9%", textAlign: "right" as const },
  wDiscount: { width: "8%", textAlign: "right" as const },
  wGstRate: { width: "6%", textAlign: "right" as const },
  wTaxable: { width: "11%", textAlign: "right" as const },
  wTax: { width: "8%", textAlign: "right" as const },
  wTax2: { width: "14%", textAlign: "right" as const },
  wAmt: { width: "10%", textAlign: "right" as const },
  // Amount in words
  amtWordsRow: { flexDirection: "row", marginBottom: 6, alignItems: "flex-start", gap: 4 },
  amtWordsLabel: { fontSize: 7.5, fontFamily: bold, color: "#333" },
  amtWordsText: { fontSize: 7.5, fontFamily: boldItalic, color: "#333", flex: 1, textTransform: "uppercase" },
  // Bottom section
  bottomSection: { flexDirection: "row", gap: 14, marginBottom: 10 },
  notesCol: { flex: 1 },
  noteText: { fontSize: 7.5, color: "#555", marginBottom: 4 },
  totalsCol: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totalRowBorder: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderTop: `0.5px solid #DDD` },
  totalLabel: { fontSize: 7.5, color: "#666", flex: 1 },
  totalVal: { fontSize: 7.5, color: "#1A1A1A" },
  grandBox: { flexDirection: "row", justifyContent: "space-between", backgroundColor: C, paddingVertical: 5, paddingHorizontal: 6, marginTop: 4 },
  grandLabel: { fontSize: 9, fontFamily: bold, color: "#fff" },
  grandVal: { fontSize: 9, fontFamily: bold, color: "#fff" },
  // Footer
  footer: { borderTop: `1.5px solid ${C}`, paddingTop: 8, marginTop: 6 },
  thankYou: { fontSize: 9, fontFamily: bold, color: "#1A1A1A", marginBottom: 4 },
  contactText: { fontSize: 7.5, color: "#555", marginBottom: 6 },
  socialRow: { flexDirection: "row", gap: 10 },
  socialLink: { fontSize: 7.5, color: C },
  signatureRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end", marginTop: 8 },
  signatureLabel: { fontSize: 8, color: "#555", marginRight: 8 },
  signatureImg: { width: 80, height: 32, objectFit: "contain" },
  pageFooter: { position: "absolute", bottom: 12, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between" },
  pageFooterText: { fontSize: 7, color: "#aaa" },
});

export function InvoicePDFTemplate9({
  invoice,
  copyType = "Original",
  customization,
}: {
  invoice: InvoiceData;
  copyType?: CopyType;
  customization?: TemplateCustomizationSettings;
}) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold, fonts.boldItalic, cx.branding.bodySize, cx.branding.headingSize);
  const { shop, lineItems } = invoice;
  const { formatDate, formatRs } = makeFormatters(shop.settings);
  const isIGST = invoice.taxType === "IGST";
  const showHsn = cx.lineItems.columnVisibility.hsCode !== false && shop.settings?.showHsnCode !== false;
  const showDiscount = cx.lineItems.columnVisibility.discount !== false && invoice.discountAmount > 0;
  const showGstRate = cx.lineItems.columnVisibility.taxRates !== false;
  const showLogo = cx.overview.showLogo && !!shop.logoUrl;
  const showSupplierGstin = cx.overview.showSupplierGstin && !!shop.gstin;
  const showBilling = cx.address.billing.show;
  const showTotalInWords = cx.totals.showTotalInWords && !!invoice.amountInWords;
  // GST invoices need the supplier's signature — show the block even without an uploaded image
  const showSignature = cx.totals.showSignature;
  const rv = cx.totals.rowVisibility;
  const roundOffAmt = rv.roundOff !== false ? Math.round(invoice.totalAmount) - invoice.totalAmount : 0;
  const showRoundOff = rv.roundOff !== false && Math.abs(roundOffAmt) >= 0.005;
  const grandTotalDisplay = showRoundOff ? Math.round(invoice.totalAmount) : invoice.totalAmount;
  const igstLabel = cx.lineItems.igstLabel || "IGST";
  const cgstLabel = cx.lineItems.cgstLabel || "CGST";
  const sgstLabel = cx.lineItems.sgstLabel || "SGST";
  const totalTax = isIGST ? invoice.igstAmount : invoice.cgstAmount + invoice.sgstAmount;
  const amountAfterTax = invoice.taxableAmount + totalTax;
  const shippingAmt = invoice.shippingAmount ?? 0;
  const shippingTaxAmt = invoice.shippingTax ?? 0;
  const totalShipping = shippingAmt + shippingTaxAmt;
  const shippingCgst = !isIGST ? shippingTaxAmt / 2 : 0;
  const shippingSgst = !isIGST ? shippingTaxAmt / 2 : 0;
  const shippingIgst = isIGST ? shippingTaxAmt : 0;
  // Shipping GST rate shown on the labels (was hard-coded "0%")
  const shippingRate = shippingAmt > 0 ? Math.round((shippingTaxAmt / shippingAmt) * 100) : 0;
  const shippingHalfRate = shippingRate / 2;
  const titleText = invoice.invoiceType === "CREDIT_NOTE" ? "CREDIT NOTE" : (cx.overview.invoiceTitleLabel || "TAX INVOICE");

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header: shop name | title | copy type */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            {showLogo
              ? <Image src={shop.logoUrl!} style={s.logo} />
              : <Text style={s.shopName}>{shop.businessName || "Business"}</Text>
            }
          </View>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.invoiceTitle}>{titleText}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={s.copyTypeBadge}>{copyType.toUpperCase()}</Text>
          </View>
        </View>

        {/* Two-column meta: invoice info + supplier info */}
        <View style={s.metaSection}>
          <View style={s.metaLeft}>
            {cx.overview.showInvoiceNumber && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{cx.overview.invoiceNumberLabel || "Invoice No"}:</Text>
                <Text style={s.metaValue}>{invoice.invoiceNumber}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Invoice Date:</Text>
              <Text style={s.metaValue}>{formatDate(invoice.invoiceDate)}</Text>
            </View>
            {cx.overview.showOrderNumber && invoice.orderName && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Order No:</Text>
                <Text style={s.metaValue}>{invoice.orderName}</Text>
              </View>
            )}
            {cx.overview.showOrderDate && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Order Date:</Text>
                <Text style={s.metaValue}>{formatDate(invoice.invoiceDate)}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Mode of Transport:</Text>
              <Text style={s.metaValue}>-</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date of Supply:</Text>
              <Text style={s.metaValue}>{formatDate(invoice.invoiceDate)}</Text>
            </View>
            {cx.overview.showPlaceOfSupply && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{cx.overview.placeOfSupplyLabel || "Place of Supply"}:</Text>
                <Text style={s.metaValue}>{placeOfSupplyText(invoice)}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>State Code:</Text>
              <Text style={s.metaValue}>{stateCodeText(invoice)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Reverse Charge:</Text>
              <Text style={s.metaValue}>{reverseChargeText(invoice)}</Text>
            </View>
          </View>
          <View style={s.metaRight}>
            <Text style={s.supplierTitle}>{shop.businessName || "Supplier"}</Text>
            {shop.address && <Text style={s.supplierDetail}>{shop.address}</Text>}
            {(shop.city || shop.state) && (
              <Text style={s.supplierDetail}>{[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}</Text>
            )}
            {shop.email && <Text style={[s.supplierDetail, { color: "#1565C0" }]}>{shop.email}</Text>}
            {showSupplierGstin && shop.gstin && (
              <Text style={s.supplierDetail}>GSTIN: {shop.gstin}</Text>
            )}
          </View>
        </View>

        {/* Address: Billed To | Ship To */}
        {showBilling && (
          <View style={s.addressSection}>
            <View style={s.addressBox}>
              <Text style={s.addressTitle}>{cx.labels.billTo || "Billed To"}</Text>
              {cx.address.billing.showName && <Text style={s.addressName}>{invoice.buyerName || "Customer"}</Text>}
              {cx.address.billing.showAddress && invoice.buyerAddress && <Text style={s.addressDetail}>{invoice.buyerAddress}</Text>}
              {(invoice.buyerCity || invoice.buyerState) && (
                <Text style={s.addressDetail}>{[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}</Text>
              )}
              {invoice.buyerEmail && <Text style={[s.addressDetail, { color: "#1565C0" }]}>{invoice.buyerEmail}</Text>}
              {cx.address.billing.showGstin && invoice.buyerGstin && <Text style={s.addressDetail}>GSTIN: {invoice.buyerGstin}</Text>}
            </View>
            <View style={s.addressBox}>
              <Text style={s.addressTitle}>Ship To</Text>
              {cx.address.billing.showName && <Text style={s.addressName}>{invoice.buyerName || "Customer"}</Text>}
              {cx.address.billing.showAddress && invoice.buyerAddress && <Text style={s.addressDetail}>{invoice.buyerAddress}</Text>}
              {(invoice.buyerCity || invoice.buyerState) && (
                <Text style={s.addressDetail}>{[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}</Text>
              )}
              {invoice.buyerEmail && <Text style={[s.addressDetail, { color: "#1565C0" }]}>{invoice.buyerEmail}</Text>}
              {cx.address.billing.showGstin && invoice.buyerGstin && <Text style={s.addressDetail}>GSTIN: {invoice.buyerGstin}</Text>}
            </View>
          </View>
        )}

        {renderCustomFields(invoice, fonts.base, fonts.bold)}

        {/* Line Items Table */}
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.wSno]}>#</Text>
            <Text style={[s.th, s.wItem]}>Item</Text>
            <Text style={[s.th, s.wQty]}>Qty</Text>
            <Text style={[s.th, s.wRate]}>Rate</Text>
            {showDiscount && <Text style={[s.th, s.wDiscount]}>Disc.</Text>}
            <Text style={[s.th, s.wTaxable]}>Taxable Val</Text>
            {showHsn && <Text style={[s.th, s.wHsn]}>HSN</Text>}
            {showGstRate && <Text style={[s.th, s.wGstRate]}>GST</Text>}
            {isIGST ? (
              <Text style={[s.th, s.wTax2]}>{igstLabel}</Text>
            ) : (
              <>
                <Text style={[s.th, s.wTax]}>{cgstLabel}</Text>
                <Text style={[s.th, s.wTax]}>{sgstLabel}</Text>
              </>
            )}
            <Text style={[s.th, s.wAmt]}>Total</Text>
          </View>

          {lineItems.map((item, i) => (
            <View key={i} style={i % 2 === 0 ? s.tableRow : s.tableRowAlt}>
              <Text style={[s.td, s.wSno]}>{i + 1}</Text>
              <View style={{ width: "28%" }}>
                <Text style={{ fontSize: 7.5 }}>{item.productName}</Text>
                {item.variantName ? <Text style={{ fontSize: 6.5, color: "#888" }}>{item.variantName}</Text> : null}
              </View>
              <View style={[s.wQty, { alignItems: "flex-end" }]}>
                <Text style={{ fontSize: 7.5 }}>{item.quantity}</Text>
                {item.unit ? <Text style={{ fontSize: 6, color: "#888" }}>{item.unit}</Text> : null}
              </View>
              <Text style={[s.td, s.wRate]}>{formatRs(item.unitPrice)}</Text>
              {showDiscount && <Text style={[s.td, s.wDiscount]}>{item.discount > 0 ? formatRs(item.discount) : "-"}</Text>}
              <Text style={[s.td, s.wTaxable]}>{formatRs(item.taxableValue)}</Text>
              {showHsn && <Text style={[s.td, s.wHsn]}>{item.hsnCode || "-"}</Text>}
              {showGstRate && <Text style={[s.td, s.wGstRate]}>{isIGST ? item.igstRate : (item.cgstRate + item.sgstRate)}%</Text>}
              {isIGST ? (
                <Text style={[s.td, s.wTax2]}>{formatRs(item.igstAmount)}</Text>
              ) : (
                <>
                  <Text style={[s.td, s.wTax]}>{formatRs(item.cgstAmount)}</Text>
                  <Text style={[s.td, s.wTax]}>{formatRs(item.sgstAmount)}</Text>
                </>
              )}
              <Text style={[s.td, s.wAmt, { fontFamily: fonts.bold }]}>{formatRs(item.totalAmount)}</Text>
            </View>
          ))}

          {/* Totals row */}
          <View style={s.tableTotRow}>
            <Text style={[s.td, s.wSno, { fontFamily: fonts.bold }]}> </Text>
            <Text style={[s.td, { width: "28%", fontFamily: fonts.bold }]}>Total</Text>
            <Text style={[s.td, s.wQty]}> </Text>
            <Text style={[s.td, s.wRate, { fontFamily: fonts.bold }]}>{formatRs(invoice.subTotal / (lineItems.length > 0 ? lineItems.reduce((a, l) => a + l.quantity, 0) : 1) * (lineItems.length > 0 ? lineItems.reduce((a, l) => a + l.quantity, 0) : 1))}</Text>
            {showDiscount && <Text style={[s.td, s.wDiscount]}> </Text>}
            <Text style={[s.td, s.wTaxable, { fontFamily: fonts.bold }]}>{formatRs(invoice.taxableAmount)}</Text>
            {showHsn && <Text style={[s.td, s.wHsn]}> </Text>}
            {showGstRate && <Text style={[s.td, s.wGstRate]}> </Text>}
            {isIGST ? (
              <Text style={[s.td, s.wTax2, { fontFamily: fonts.bold }]}>{formatRs(invoice.igstAmount)}</Text>
            ) : (
              <>
                <Text style={[s.td, s.wTax, { fontFamily: fonts.bold }]}>{formatRs(invoice.cgstAmount)}</Text>
                <Text style={[s.td, s.wTax, { fontFamily: fonts.bold }]}>{formatRs(invoice.sgstAmount)}</Text>
              </>
            )}
            <Text style={[s.td, s.wAmt, { fontFamily: fonts.bold }]}>{formatRs(invoice.totalAmount - shippingAmt - shippingTaxAmt)}</Text>
          </View>
        </View>

        {/* Amount in words */}
        {showTotalInWords && (
          <View style={s.amtWordsRow}>
            <Text style={s.amtWordsLabel}>Amount in words</Text>
            <Text style={s.amtWordsText}>{invoice.amountInWords}</Text>
          </View>
        )}

        {/* Bottom: notes + totals */}
        <View style={s.bottomSection}>
          <View style={s.notesCol}>
            {(cx.notes.showOrderNotes && invoice.orderNote) ? (
              <Text style={s.noteText}>{invoice.orderNote}</Text>
            ) : null}
            {(cx.footer.showFooterNotes && cx.footer.footerNotes) ? (
              <Text style={s.noteText}>{cx.footer.footerNotes}</Text>
            ) : null}
          </View>
          <View style={s.totalsCol}>
            {invoice.discountAmount > 0 && rv.discount !== false && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total Discount:</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.totalVal}>{formatRs(invoice.discountAmount)}</Text>
                  <Text style={{ fontSize: 6.5, color: "#888" }}>Custom discount</Text>
                </View>
              </View>
            )}
            {rv.beforeTax !== false && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total Amount before Tax:</Text>
                <Text style={s.totalVal}>{formatRs(invoice.taxableAmount)}</Text>
              </View>
            )}
            {rv.totalTax !== false && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total Tax Amount:</Text>
                <Text style={s.totalVal}>{formatRs(totalTax)}</Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total Amount After Tax:</Text>
              <Text style={s.totalVal}>{formatRs(amountAfterTax)}</Text>
            </View>
            {shippingAmt > 0 && rv.shippingAmount !== false && (
              <>
                <View style={s.totalRowBorder}>
                  <Text style={s.totalLabel}>Shipping Amount:</Text>
                  <Text style={s.totalVal}>{formatRs(shippingAmt)}</Text>
                </View>
                {!isIGST ? (
                  <>
                    <View style={s.totalRow}>
                      <Text style={s.totalLabel}>Shipping {cgstLabel} ({shippingHalfRate}%):</Text>
                      <Text style={s.totalVal}>{formatRs(shippingCgst)}</Text>
                    </View>
                    <View style={s.totalRow}>
                      <Text style={s.totalLabel}>Shipping {sgstLabel} ({shippingHalfRate}%):</Text>
                      <Text style={s.totalVal}>{formatRs(shippingSgst)}</Text>
                    </View>
                  </>
                ) : (
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Shipping {igstLabel} ({shippingRate}%):</Text>
                    <Text style={s.totalVal}>{formatRs(shippingIgst)}</Text>
                  </View>
                )}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Shipping:</Text>
                  <Text style={s.totalVal}>{formatRs(totalShipping)}</Text>
                </View>
              </>
            )}
            {showRoundOff && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Round Off</Text>
                <Text style={s.totalVal}>{roundOffAmt >= 0 ? `+${formatRs(roundOffAmt)}` : `-${formatRs(Math.abs(roundOffAmt))}`}</Text>
              </View>
            )}
            {rv.grandTotal !== false && (
              <View style={s.grandBox}>
                <Text style={s.grandLabel}>Total</Text>
                <Text style={s.grandVal}>{formatRs(grandTotalDisplay)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Signature */}
        {showSignature && (
          <View style={s.signatureRow}>
            <Text style={s.signatureLabel}>Authorised Signatory</Text>
            {shop.signatureUrl ? <Image src={shop.signatureUrl} style={s.signatureImg} /> : <View style={{ width: 100, height: 32 }} />}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          {(cx.notes.showThankYou || cx.notes.thankYouNote) && (
            <Text style={s.thankYou}>{cx.notes.thankYouNote || "Thank you for your purchase!"}</Text>
          )}
          {cx.notes.showContactEmail && cx.notes.contactEmail && (
            <Text style={s.contactText}>{cx.notes.emailPrefixText || "If you have any questions, please contact us at"} {cx.notes.contactEmail}</Text>
          )}
          {(cx.footer.showWebsite || cx.footer.showFacebook || cx.footer.showX || cx.footer.showInstagram) && (
            <View style={s.socialRow}>
              {cx.footer.showWebsite && cx.footer.websiteUrl && <Text style={s.socialLink}>/{cx.footer.websiteUrl.replace(/https?:\/\//, "")}</Text>}
              {cx.footer.showFacebook && cx.footer.facebookUrl && <Text style={s.socialLink}>/Facebook</Text>}
              {cx.footer.showX && cx.footer.xUrl && <Text style={s.socialLink}>/Twitter</Text>}
              {cx.footer.showInstagram && cx.footer.instagramUrl && <Text style={s.socialLink}>/Instagram</Text>}
            </View>
          )}
        </View>

        <View style={s.pageFooter} fixed>
          <Text style={s.pageFooterText}>{invoice.invoiceNumber}</Text>
          <Text style={s.pageFooterText}>{formatDate(invoice.invoiceDate)}</Text>
        </View>
      </Page>
    </Document>
  );
}
