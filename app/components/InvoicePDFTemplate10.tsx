import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { InvoiceData, CopyType } from "./invoice-pdf-types";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";

// Clarity — orange accent, outer border, shop name large centered, 3-column address, computer-generated footer
const C = "#E07B30";
const LIGHT = "#FFF3E8";
const BORDER = "0.5px solid #CCCCCC";

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: { fontFamily: base, fontSize: bodySize, color: "#1A1A1A", paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0 },
  outerBorder: { margin: 16, border: BORDER, flex: 1 },
  // Top header strip: GSTIN | Tax Invoice | Original
  headerStrip: { flexDirection: "row", borderBottom: BORDER },
  headerCell: { flex: 1, padding: "5 8", borderRight: BORDER },
  headerCellCenter: { flex: 1, padding: "5 8", borderRight: BORDER, alignItems: "center" },
  headerCellRight: { flex: 1, padding: "5 8", alignItems: "flex-end" },
  headerSmall: { fontSize: 7.5, color: "#555" },
  headerTitle: { fontSize: headingSize, fontFamily: bold, color: "#1A1A1A" },
  headerCopyType: { fontSize: headingSize - 2, fontFamily: bold, color: C },
  // Shop name centered below header
  shopNameSection: { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", borderBottom: BORDER },
  shopName: { fontSize: headingSize + 3, fontFamily: bold, color: "#1A1A1A", textAlign: "center" },
  shopContact: { fontSize: 7.5, color: "#1565C0", textAlign: "center", marginTop: 2 },
  // Invoice meta
  metaRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, borderBottom: BORDER },
  metaCol: { flex: 1 },
  metaItem: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { fontSize: 7.5, color: "#888", width: 90 },
  metaValue: { fontSize: 7.5, color: "#1A1A1A", flex: 1 },
  // 3-column address table
  addrTable: { marginHorizontal: 16, marginBottom: 10, border: BORDER },
  addrHeaderRow: { flexDirection: "row", borderBottom: BORDER },
  addrHeaderCell: { flex: 1, backgroundColor: "#EEEEEE", padding: 4, borderRight: BORDER },
  addrHeaderCellLast: { flex: 1, backgroundColor: "#EEEEEE", padding: 4 },
  addrHeaderText: { fontSize: 7, fontFamily: bold, textTransform: "uppercase", color: "#333" },
  addrBodyRow: { flexDirection: "row" },
  addrBodyCell: { flex: 1, padding: "5 6", borderRight: BORDER },
  addrBodyCellLast: { flex: 1, padding: "5 6" },
  addrName: { fontSize: 8, fontFamily: bold, marginBottom: 2 },
  addrDetail: { fontSize: 7.5, color: "#555", marginBottom: 1 },
  // Line items table
  tableWrap: { marginHorizontal: 16, marginBottom: 10, border: BORDER },
  tableHead: { flexDirection: "row", backgroundColor: "#EEEEEE", padding: "4 4" },
  tableRow: { flexDirection: "row", padding: "3 4", borderBottom: BORDER },
  tableRowAlt: { flexDirection: "row", padding: "3 4", backgroundColor: LIGHT, borderBottom: BORDER },
  th: { color: "#333", fontSize: 7, fontFamily: bold },
  td: { fontSize: 7.5 },
  wSno: { width: "4%" },
  wItem: { width: "24%" },
  wHsn: { width: "7%", textAlign: "right" as const },
  wQty: { width: "5%", textAlign: "right" as const },
  wRate: { width: "9%", textAlign: "right" as const },
  wDiscount: { width: "8%", textAlign: "right" as const },
  wGstRate: { width: "6%", textAlign: "right" as const },
  wTaxable: { width: "11%", textAlign: "right" as const },
  wTax: { width: "8%", textAlign: "right" as const },
  wTax2: { width: "14%", textAlign: "right" as const },
  wAmt: { width: "10%", textAlign: "right" as const },
  // Bottom section: terms + totals
  bottomSection: { flexDirection: "row", marginHorizontal: 16, border: BORDER, marginBottom: 10 },
  termsCol: { flex: 1, padding: 8, borderRight: BORDER },
  termsLabel: { fontSize: 7.5, fontFamily: bold, color: "#333", marginBottom: 4 },
  termsText: { fontSize: 7.5, color: "#555", marginBottom: 3 },
  amtWordsLabel: { fontSize: 7.5, fontFamily: bold, color: "#333", marginTop: 4, marginBottom: 2 },
  amtWordsText: { fontSize: 7.5, fontFamily: boldItalic, color: "#555", textTransform: "uppercase" },
  eoeText: { fontSize: 7, color: "#888", marginTop: 4 },
  noteText: { fontSize: 7.5, color: "#555", marginTop: 4 },
  totalsCol: { width: 230, padding: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totalRowBorder: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderTop: `0.5px solid #DDD`, marginTop: 1 },
  totalLabel: { fontSize: 7.5, color: "#555", flex: 1 },
  totalVal: { fontSize: 7.5 },
  grandBox: { flexDirection: "row", justifyContent: "space-between", border: `1px solid #333`, paddingVertical: 5, paddingHorizontal: 6, marginTop: 6 },
  grandLabel: { fontSize: 9, fontFamily: bold, color: "#1A1A1A" },
  grandVal: { fontSize: 9, fontFamily: bold, color: "#1A1A1A" },
  // Footer
  footerArea: { marginHorizontal: 16, paddingVertical: 8, alignItems: "center", borderTop: BORDER },
  socialRow: { flexDirection: "row", justifyContent: "center", gap: 14, marginBottom: 6 },
  socialText: { fontSize: 7.5, color: "#555" },
  computerGenText: { fontSize: 7.5, color: C, textAlign: "center", marginBottom: 3 },
  poweredBy: { fontSize: 7.5, color: C, textAlign: "center" },
  pageFooter: { position: "absolute", bottom: 12, left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
  pageFooterText: { fontSize: 7, color: "#aaa" },
});

export function InvoicePDFTemplate10({
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
  const showTotalInWords = cx.totals.showTotalInWords && !!invoice.amountInWords;
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
  const titleText = invoice.invoiceType === "CREDIT_NOTE" ? "Credit Note" : (cx.overview.invoiceTitleLabel || "Tax Invoice");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.outerBorder}>

          {/* Header strip */}
          <View style={s.headerStrip}>
            <View style={s.headerCell}>
              <Text style={s.headerSmall}>GSTIN: {shop.gstin || ""}</Text>
            </View>
            <View style={s.headerCellCenter}>
              <Text style={s.headerTitle}>{titleText}</Text>
            </View>
            <View style={s.headerCellRight}>
              <Text style={s.headerCopyType}>{copyType}</Text>
            </View>
          </View>

          {/* Shop name + contact centered */}
          <View style={s.shopNameSection}>
            {showLogo
              ? <Image src={shop.logoUrl!} style={{ width: cx.overview.logoWidth || 80, height: 40, objectFit: "contain", marginBottom: 4 }} />
              : null
            }
            <Text style={s.shopName}>{shop.businessName || "Business Name"}</Text>
            {shop.email && <Text style={s.shopContact}>{shop.email}</Text>}
            {shop.city && <Text style={[s.shopContact, { color: "#555" }]}>{[shop.city, shop.state].filter(Boolean).join(", ")}</Text>}
          </View>

          {/* Invoice meta row */}
          <View style={s.metaRow}>
            <View style={s.metaCol}>
              {cx.overview.showInvoiceNumber && (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>Invoice No:</Text>
                  <Text style={s.metaValue}>{invoice.invoiceNumber}</Text>
                </View>
              )}
              {cx.overview.showOrderNumber && invoice.orderName && (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>Order Id:</Text>
                  <Text style={s.metaValue}>{invoice.orderName}</Text>
                </View>
              )}
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Invoice Date:</Text>
                <Text style={s.metaValue}>{formatDate(invoice.invoiceDate)}</Text>
              </View>
              {cx.overview.showPaymentGateway && invoice.paymentMethod && (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>Payment:</Text>
                  <Text style={s.metaValue}>{invoice.paymentMethod}</Text>
                </View>
              )}
            </View>
            <View style={s.metaCol}>
              {cx.overview.showPlaceOfSupply && (
                <>
                  <View style={s.metaItem}>
                    <Text style={s.metaLabel}>Place of Supply</Text>
                    <Text style={s.metaValue}>{invoice.buyerCity ? `${invoice.buyerCity}, ${invoice.buyerState}` : (invoice.placeOfSupply || "-")}</Text>
                  </View>
                  <View style={s.metaItem}>
                    <Text style={s.metaLabel}>State Code:</Text>
                    <Text style={s.metaValue}>GJ ({invoice.placeOfSupply || "-"})</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* 3-column address: BILLED TO | SHIP TO | SUPPLIER */}
          <View style={s.addrTable}>
            <View style={s.addrHeaderRow}>
              <View style={s.addrHeaderCell}>
                <Text style={s.addrHeaderText}>Billed To</Text>
              </View>
              <View style={s.addrHeaderCell}>
                <Text style={s.addrHeaderText}>Ship To</Text>
              </View>
              <View style={s.addrHeaderCellLast}>
                <Text style={s.addrHeaderText}>Supplier</Text>
              </View>
            </View>
            <View style={s.addrBodyRow}>
              {/* Billed To */}
              <View style={s.addrBodyCell}>
                {cx.address.billing.showName && <Text style={s.addrName}>{invoice.buyerName || "Customer"}</Text>}
                {cx.address.billing.showAddress && invoice.buyerAddress && <Text style={s.addrDetail}>{invoice.buyerAddress}</Text>}
                {(invoice.buyerCity || invoice.buyerState) && (
                  <Text style={s.addrDetail}>{[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}</Text>
                )}
                {cx.address.billing.showEmail && invoice.buyerEmail && <Text style={[s.addrDetail, { color: "#1565C0" }]}>{invoice.buyerEmail}</Text>}
                {cx.address.billing.showGstin && invoice.buyerGstin && <Text style={s.addrDetail}>GSTIN: {invoice.buyerGstin}</Text>}
              </View>
              {/* Ship To — same data */}
              <View style={s.addrBodyCell}>
                {cx.address.billing.showName && <Text style={s.addrName}>{invoice.buyerName || "Customer"}</Text>}
                {cx.address.billing.showAddress && invoice.buyerAddress && <Text style={s.addrDetail}>{invoice.buyerAddress}</Text>}
                {(invoice.buyerCity || invoice.buyerState) && (
                  <Text style={s.addrDetail}>{[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}</Text>
                )}
                {cx.address.billing.showEmail && invoice.buyerEmail && <Text style={[s.addrDetail, { color: "#1565C0" }]}>{invoice.buyerEmail}</Text>}
                {cx.address.billing.showGstin && invoice.buyerGstin && <Text style={s.addrDetail}>GSTIN: {invoice.buyerGstin}</Text>}
              </View>
              {/* Supplier */}
              <View style={s.addrBodyCellLast}>
                <Text style={s.addrName}>{shop.businessName || "-"}</Text>
                {shop.address && <Text style={s.addrDetail}>{shop.address}</Text>}
                {(shop.city || shop.state) && (
                  <Text style={s.addrDetail}>{[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}</Text>
                )}
                {shop.email && <Text style={[s.addrDetail, { color: "#1565C0" }]}>{shop.email}</Text>}
                {showSupplierGstin && shop.gstin && <Text style={s.addrDetail}>GSTIN: {shop.gstin}</Text>}
              </View>
            </View>
          </View>

          {renderCustomFields(invoice, fonts.base, fonts.bold)}

          {/* Line items table */}
          <View style={s.tableWrap}>
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
                <View style={{ width: "24%" }}>
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

            {/* Total row */}
            <View style={[s.tableRow, { backgroundColor: "#F5F5F5" }]}>
              <Text style={[s.td, s.wSno]}> </Text>
              <Text style={[s.td, { width: "24%", fontFamily: fonts.bold }]}>Total</Text>
              <Text style={[s.td, s.wQty]}> </Text>
              <Text style={[s.td, s.wRate, { fontFamily: fonts.bold }]}>{formatRs(lineItems.reduce((a, l) => a + l.unitPrice * l.quantity, 0))}</Text>
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

          {/* Bottom: terms + totals */}
          <View style={s.bottomSection}>
            <View style={s.termsCol}>
              <Text style={s.termsLabel}>Terms and Conditions apply</Text>
              {showTotalInWords && (
                <>
                  <Text style={s.amtWordsLabel}>Amount in words</Text>
                  <Text style={s.amtWordsText}>{invoice.amountInWords}</Text>
                </>
              )}
              <Text style={s.eoeText}>E. &amp; O.E</Text>
              {cx.notes.showOrderNotes && invoice.orderNote && (
                <Text style={s.noteText}>{invoice.orderNote}</Text>
              )}
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
                        <Text style={s.totalLabel}>Shipping {cgstLabel} (0%):</Text>
                        <Text style={s.totalVal}>{formatRs(shippingCgst)}</Text>
                      </View>
                      <View style={s.totalRow}>
                        <Text style={s.totalLabel}>Shipping {sgstLabel} (0%):</Text>
                        <Text style={s.totalVal}>{formatRs(shippingSgst)}</Text>
                      </View>
                    </>
                  ) : (
                    <View style={s.totalRow}>
                      <Text style={s.totalLabel}>Shipping {igstLabel} (0%):</Text>
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

          {/* Footer */}
          <View style={s.footerArea}>
            {(cx.footer.showWebsite || cx.footer.showFacebook || cx.footer.showX || cx.footer.showInstagram) && (
              <View style={s.socialRow}>
                {cx.footer.showWebsite && <Text style={s.socialText}>🌐</Text>}
                {cx.footer.showFacebook && <Text style={s.socialText}>f</Text>}
                {cx.footer.showX && <Text style={s.socialText}>t</Text>}
                {cx.footer.showInstagram && <Text style={s.socialText}>📷</Text>}
              </View>
            )}
            <Text style={s.computerGenText}>This is computer generated invoice and hence no signature is required</Text>
            <Text style={s.poweredBy}>Powered By GST Pro</Text>
          </View>

        </View>

        <View style={s.pageFooter} fixed>
          <Text style={s.pageFooterText}>{invoice.invoiceNumber}</Text>
          <Text style={s.pageFooterText}>{formatDate(invoice.invoiceDate)}</Text>
        </View>
      </Page>
    </Document>
  );
}
