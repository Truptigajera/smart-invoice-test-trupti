import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { InvoiceData, CopyType } from "./invoice-pdf-types";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";
import { placeOfSupplyText, stateCodeText, reverseChargeText } from "~/lib/pdf-helpers";

// Ember — orange/amber accents, outer-bordered layout, 3-column address table
const C = "#E07B30";
const LIGHT = "#FFF3E8";
const BORDER = "0.5px solid #CCCCCC";

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: {
    fontFamily: base,
    fontSize: bodySize,
    color: "#1A1A1A",
    paddingTop: 0,
    paddingBottom: 40,
    paddingHorizontal: 0,
  },
  outerBorder: {
    margin: 16,
    border: BORDER,
    flex: 1,
  },
  // Top header strip: GSTIN | Title | CopyType
  headerStrip: {
    flexDirection: "row",
    borderBottom: BORDER,
    backgroundColor: LIGHT,
  },
  headerStripCell: {
    flex: 1,
    padding: "5 8",
    alignItems: "center",
    justifyContent: "center",
  },
  headerStripCellBorder: {
    flex: 1,
    padding: "5 8",
    alignItems: "center",
    justifyContent: "center",
    borderRight: BORDER,
  },
  headerStripText: {
    fontSize: 7.5,
    color: "#555",
    textAlign: "center",
  },
  headerStripTitle: {
    fontSize: headingSize,
    fontFamily: bold,
    color: C,
    textAlign: "center",
  },
  // Logo + contact row
  logoRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: BORDER,
  },
  logo: {
    height: 48,
    objectFit: "contain",
  },
  shopContact: {
    fontSize: 7.5,
    color: "#555",
    textAlign: "right",
    marginTop: 2,
  },
  // Invoice meta row
  metaRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottom: BORDER,
    gap: 6,
  },
  metaCol: {
    flex: 1,
  },
  metaItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  metaLabel: {
    fontSize: 7.5,
    color: "#888",
    width: 90,
  },
  metaValue: {
    fontSize: 7.5,
    color: "#1A1A1A",
    flex: 1,
  },
  // 3-column address table
  addressTable: {
    flexDirection: "column",
    marginHorizontal: 16,
    marginBottom: 10,
    border: BORDER,
  },
  addressHeaderRow: {
    flexDirection: "row",
    borderBottom: BORDER,
  },
  addressHeaderCell: {
    flex: 1,
    backgroundColor: "#EEEEEE",
    padding: 4,
    borderRight: BORDER,
  },
  addressHeaderCellLast: {
    flex: 1,
    backgroundColor: "#EEEEEE",
    padding: 4,
  },
  addressHeaderText: {
    fontSize: 7,
    fontFamily: bold,
    textTransform: "uppercase",
    color: "#333",
  },
  addressBodyRow: {
    flexDirection: "row",
  },
  addressBodyCell: {
    flex: 1,
    padding: "5 6",
    borderRight: BORDER,
  },
  addressBodyCellLast: {
    flex: 1,
    padding: "5 6",
  },
  addressName: {
    fontSize: 8,
    fontFamily: bold,
    marginBottom: 2,
    color: "#1A1A1A",
  },
  addressDetail: {
    fontSize: 7.5,
    color: "#555",
    marginBottom: 1,
  },
  // Line items table
  tableWrap: {
    marginHorizontal: 16,
    marginBottom: 10,
    border: BORDER,
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C,
    padding: "4 4",
  },
  tableRow: {
    flexDirection: "row",
    padding: "3 4",
    borderBottom: BORDER,
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: "3 4",
    backgroundColor: LIGHT,
    borderBottom: BORDER,
  },
  th: {
    color: "#fff",
    fontSize: 7,
    fontFamily: bold,
  },
  td: {
    fontSize: 7.5,
  },
  wSno: { width: "4%" },
  wItem: { width: "24%" },
  wHsn: { width: "7%", textAlign: "right" as const },
  wQty: { width: "6%", textAlign: "right" as const },
  wRate: { width: "9%", textAlign: "right" as const },
  wDiscount: { width: "8%", textAlign: "right" as const },
  wGstRate: { width: "6%", textAlign: "right" as const },
  wTaxable: { width: "10%", textAlign: "right" as const },
  wTax: { width: "8%", textAlign: "right" as const },
  wTax2: { width: "14%", textAlign: "right" as const },
  wAmt: { width: "9%", textAlign: "right" as const },
  // Bottom section: terms + totals
  bottomSection: {
    flexDirection: "row",
    marginHorizontal: 16,
    border: BORDER,
    marginBottom: 10,
  },
  termsCol: {
    flex: 1,
    padding: 8,
    borderRight: BORDER,
  },
  termsLabel: {
    fontSize: 7.5,
    fontFamily: bold,
    color: "#333",
    marginBottom: 4,
  },
  termsText: {
    fontSize: 7.5,
    color: "#555",
    marginBottom: 4,
  },
  amtWordsText: {
    fontSize: 7.5,
    fontFamily: boldItalic,
    color: "#555",
    marginTop: 4,
  },
  eoeText: {
    fontSize: 7,
    color: "#888",
    marginTop: 4,
  },
  totalsCol: {
    width: 230,
    padding: 8,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalLabel: {
    fontSize: 7.5,
    color: "#555",
    flex: 1,
  },
  totalVal: {
    fontSize: 7.5,
    color: "#1A1A1A",
  },
  grandBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  grandLabel: {
    fontSize: 9,
    fontFamily: bold,
    color: "#fff",
  },
  grandVal: {
    fontSize: 9,
    fontFamily: bold,
    color: "#fff",
  },
  // Footer area
  footerArea: {
    marginHorizontal: 16,
    paddingVertical: 8,
    borderTop: BORDER,
  },
  socialRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 4,
  },
  socialText: {
    fontSize: 7.5,
    color: "#555",
  },
  poweredBy: {
    fontSize: 7.5,
    color: C,
    textAlign: "center",
    marginBottom: 6,
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 6,
  },
  signatureLabel: {
    fontSize: 8,
    color: "#555",
  },
  signatureImg: {
    width: 80,
    height: 32,
    objectFit: "contain",
  },
  // Absolute page footer
  pageFooter: {
    position: "absolute",
    bottom: 12,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pageFooterText: {
    fontSize: 7,
    color: "#999",
  },
});

export function InvoicePDFTemplate7({
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
  // Footer links as plain text and only when a URL is set — the PDF font has no glyphs for
  // icon characters, which printed as "f t =÷" even with no links configured
  const socialLinks = [
    cx.footer.showWebsite && cx.footer.websiteUrl ? `Web: ${cx.footer.websiteUrl}` : null,
    cx.footer.showFacebook && cx.footer.facebookUrl ? `Facebook: ${cx.footer.facebookUrl}` : null,
    cx.footer.showX && cx.footer.xUrl ? `X: ${cx.footer.xUrl}` : null,
    cx.footer.showInstagram && cx.footer.instagramUrl ? `Instagram: ${cx.footer.instagramUrl}` : null,
  ].filter((l): l is string => !!l);
  const titleText =
    invoice.invoiceType === "CREDIT_NOTE"
      ? "CREDIT NOTE"
      : cx.overview.invoiceTitleLabel || "TAX INVOICE";

  const billToLabel = cx.labels.billTo || "Billed To";
  const shipToLabel = cx.labels.shipTo || "Ship To";
  const supplierLabel = cx.labels.supplier || "Supplier";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.outerBorder}>
          {/* ── TOP HEADER STRIP ── */}
          <View style={s.headerStrip}>
            <View style={s.headerStripCellBorder}>
              {showSupplierGstin ? (
                <Text style={s.headerStripText}>GSTIN: {shop.gstin}</Text>
              ) : (
                <Text style={s.headerStripText}>{shop.businessName || ""}</Text>
              )}
            </View>
            <View style={s.headerStripCellBorder}>
              {cx.overview.showTitle ? (
                <Text style={s.headerStripTitle}>{titleText}</Text>
              ) : null}
            </View>
            <View style={s.headerStripCell}>
              <Text style={[s.headerStripText, { fontFamily: fonts.bold, color: "#333" }]}>
                {copyType}
              </Text>
            </View>
          </View>

          {/* ── LOGO + CONTACT ROW ── */}
          <View style={s.logoRow}>
            <View style={{ flex: 1, alignItems: "flex-start" }}>
              {showLogo ? (
                <Image
                  src={shop.logoUrl!}
                  style={{ ...s.logo, width: cx.overview.logoWidth || 100 }}
                />
              ) : (
                <Text style={{ fontSize: cx.branding.headingSize, fontFamily: fonts.bold, color: C }}>
                  {shop.businessName || ""}
                </Text>
              )}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {shop.email ? (
                <Text style={s.shopContact}>{shop.email}</Text>
              ) : null}
              {shop.phone ? (
                <Text style={s.shopContact}>Ph: {shop.phone}</Text>
              ) : null}
              {cx.address.supplier.show && shop.address ? (
                <Text style={s.shopContact}>{shop.address}</Text>
              ) : null}
              {cx.address.supplier.show && (shop.city || shop.state) ? (
                <Text style={s.shopContact}>
                  {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
                </Text>
              ) : null}
            </View>
          </View>

          {/* ── INVOICE META ROW ── */}
          <View style={s.metaRow}>
            <View style={s.metaCol}>
              {cx.overview.showInvoiceNumber ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>{cx.overview.invoiceNumberLabel || "Invoice No"}:</Text>
                  <Text style={[s.metaValue, { fontFamily: fonts.bold }]}>{invoice.invoiceNumber}</Text>
                </View>
              ) : null}
              {cx.overview.showOrderNumber && (invoice as any).orderName ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>Order Id:</Text>
                  <Text style={s.metaValue}>{(invoice as any).orderName}</Text>
                </View>
              ) : null}
              {cx.overview.showOrderDate ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>Invoice Date:</Text>
                  <Text style={s.metaValue}>{formatDate(invoice.invoiceDate)}</Text>
                </View>
              ) : null}
              {cx.overview.showPaymentGateway && (invoice as any).paymentMethod ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>{cx.overview.paymentLabel || "Payment"}:</Text>
                  <Text style={s.metaValue}>{(invoice as any).paymentMethod}</Text>
                </View>
              ) : null}
              {invoice.reverseCharge ? (
                <View style={s.metaItem}>
                  <Text style={[s.metaLabel, { color: "#e53935" }]}>Reverse Charge:</Text>
                  <Text style={[s.metaValue, { color: "#e53935" }]}>Applicable</Text>
                </View>
              ) : null}
            </View>
            <View style={s.metaCol}>
              {cx.overview.showPlaceOfSupply ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>{cx.overview.placeOfSupplyLabel || "Place of Supply"}:</Text>
                  <Text style={s.metaValue}>{placeOfSupplyText(invoice)}</Text>
                </View>
              ) : null}
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Reverse Charge:</Text>
                <Text style={s.metaValue}>{reverseChargeText(invoice)}</Text>
              </View>
              {cx.address.billing.showStateCode && invoice.buyerState ? (
                <View style={s.metaItem}>
                  <Text style={s.metaLabel}>State Code:</Text>
                  <Text style={s.metaValue}>{stateCodeText(invoice)}</Text>
                </View>
              ) : null}
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Tax Type:</Text>
                <Text style={s.metaValue}>
                  {isIGST ? igstLabel : `${cgstLabel} + ${sgstLabel}`}
                </Text>
              </View>
              <View style={s.metaItem}>
                <Text style={s.metaLabel}>Supply Type:</Text>
                <Text style={s.metaValue}>{invoice.supplyType}</Text>
              </View>
            </View>
          </View>

          {/* ── 3-COLUMN ADDRESS TABLE ── */}
          <View style={s.addressTable}>
            {/* Header row */}
            <View style={s.addressHeaderRow}>
              <View style={s.addressHeaderCell}>
                <Text style={s.addressHeaderText}>{billToLabel}</Text>
              </View>
              <View style={s.addressHeaderCell}>
                <Text style={s.addressHeaderText}>{shipToLabel}</Text>
              </View>
              <View style={s.addressHeaderCellLast}>
                <Text style={s.addressHeaderText}>{supplierLabel}</Text>
              </View>
            </View>
            {/* Body row */}
            <View style={s.addressBodyRow}>
              {/* Billed To */}
              <View style={s.addressBodyCell}>
                {showBilling ? (
                  <>
                    {cx.address.billing.showName ? (
                      <Text style={s.addressName}>{invoice.buyerName || "Customer"}</Text>
                    ) : null}
                    {cx.address.billing.showAddress && invoice.buyerAddress ? (
                      <Text style={s.addressDetail}>{invoice.buyerAddress}</Text>
                    ) : null}
                    {(invoice.buyerCity || invoice.buyerState) ? (
                      <Text style={s.addressDetail}>
                        {[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    ) : null}
                    {cx.address.billing.showPhone && invoice.buyerPhone ? (
                      <Text style={s.addressDetail}>Ph: {invoice.buyerPhone}</Text>
                    ) : null}
                    {cx.address.billing.showEmail && invoice.buyerEmail ? (
                      <Text style={s.addressDetail}>{invoice.buyerEmail}</Text>
                    ) : null}
                    {cx.address.billing.showGstin && invoice.buyerGstin ? (
                      <Text style={s.addressDetail}>GSTIN: {invoice.buyerGstin}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={s.addressDetail}>-</Text>
                )}
              </View>
              {/* Ship To (same as billing — no separate shipping address stored) */}
              <View style={s.addressBodyCell}>
                {showBilling ? (
                  <>
                    {cx.address.billing.showName ? (
                      <Text style={s.addressName}>{invoice.buyerName || "Customer"}</Text>
                    ) : null}
                    {cx.address.billing.showAddress && invoice.buyerAddress ? (
                      <Text style={s.addressDetail}>{invoice.buyerAddress}</Text>
                    ) : null}
                    {(invoice.buyerCity || invoice.buyerState) ? (
                      <Text style={s.addressDetail}>
                        {[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    ) : null}
                    {cx.address.billing.showPhone && invoice.buyerPhone ? (
                      <Text style={s.addressDetail}>Ph: {invoice.buyerPhone}</Text>
                    ) : null}
                    {cx.address.billing.showEmail && invoice.buyerEmail ? (
                      <Text style={s.addressDetail}>{invoice.buyerEmail}</Text>
                    ) : null}
                    {cx.address.billing.showGstin && invoice.buyerGstin ? (
                      <Text style={s.addressDetail}>GSTIN: {invoice.buyerGstin}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={s.addressDetail}>-</Text>
                )}
              </View>
              {/* Supplier */}
              <View style={s.addressBodyCellLast}>
                {cx.address.supplier.show ? (
                  <>
                    <Text style={s.addressName}>{shop.businessName || "Supplier"}</Text>
                    {cx.address.supplier.showAddress && shop.address ? (
                      <Text style={s.addressDetail}>{shop.address}</Text>
                    ) : null}
                    {(shop.city || shop.state) ? (
                      <Text style={s.addressDetail}>
                        {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
                      </Text>
                    ) : null}
                    {cx.address.supplier.showPhone && shop.phone ? (
                      <Text style={s.addressDetail}>Ph: {shop.phone}</Text>
                    ) : null}
                    {shop.email ? (
                      <Text style={s.addressDetail}>{shop.email}</Text>
                    ) : null}
                    {showSupplierGstin ? (
                      <Text style={s.addressDetail}>GSTIN: {shop.gstin}</Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            </View>
          </View>

          {/* Custom fields */}
          <View style={{ marginHorizontal: 16 }}>
            {renderCustomFields(invoice, fonts.base, fonts.bold)}
          </View>

          {/* ── LINE ITEMS TABLE ── */}
          <View style={s.tableWrap}>
            <View style={s.tableHead}>
              <Text style={[s.th, s.wSno]}>#</Text>
              <Text style={[s.th, s.wItem]}>Item</Text>
              {showHsn && <Text style={[s.th, s.wHsn]}>HSN</Text>}
              <Text style={[s.th, s.wQty]}>Qty</Text>
              <Text style={[s.th, s.wRate]}>Rate</Text>
              {showDiscount && <Text style={[s.th, s.wDiscount]}>Disc.</Text>}
              <Text style={[s.th, s.wTaxable]}>Taxable</Text>
              {showGstRate && <Text style={[s.th, s.wGstRate]}>GST%</Text>}
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
                <Text style={[s.td, s.wSno, { color: "#999" }]}>{i + 1}</Text>
                <View style={{ width: "24%" }}>
                  <Text style={{ fontSize: 7.5 }}>{item.productName}</Text>
                  {item.variantName ? (
                    <Text style={{ fontSize: 6.5, color: "#888" }}>{item.variantName}</Text>
                  ) : null}
                </View>
                {showHsn && (
                  <Text style={[s.td, s.wHsn, { color: "#888" }]}>{item.hsnCode || "-"}</Text>
                )}
                <View style={{ width: "6%", alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 7.5 }}>{item.quantity}</Text>
                  {item.unit ? (
                    <Text style={{ fontSize: 6, color: "#888" }}>{item.unit}</Text>
                  ) : null}
                </View>
                <Text style={[s.td, s.wRate]}>{formatRs(item.unitPrice)}</Text>
                {showDiscount && (
                  <Text style={[s.td, s.wDiscount]}>
                    {item.discount > 0 ? formatRs(item.discount) : "-"}
                  </Text>
                )}
                <Text style={[s.td, s.wTaxable]}>{formatRs(item.taxableValue)}</Text>
                {showGstRate && (
                  <Text style={[s.td, s.wGstRate, { color: "#666" }]}>
                    {isIGST ? item.igstRate : item.cgstRate + item.sgstRate}%
                  </Text>
                )}
                {isIGST ? (
                  <Text style={[s.td, s.wTax2, { color: "#555" }]}>
                    {showGstRate
                      ? formatRs(item.igstAmount)
                      : `${item.igstRate}%\n${formatRs(item.igstAmount)}`}
                  </Text>
                ) : (
                  <>
                    <Text style={[s.td, s.wTax, { color: "#555" }]}>
                      {showGstRate
                        ? formatRs(item.cgstAmount)
                        : `${item.cgstRate}%\n${formatRs(item.cgstAmount)}`}
                    </Text>
                    <Text style={[s.td, s.wTax, { color: "#555" }]}>
                      {showGstRate
                        ? formatRs(item.sgstAmount)
                        : `${item.sgstRate}%\n${formatRs(item.sgstAmount)}`}
                    </Text>
                  </>
                )}
                <Text style={[s.td, s.wAmt, { fontFamily: fonts.bold }]}>
                  {formatRs(item.totalAmount)}
                </Text>
              </View>
            ))}
          </View>

          {/* ── BOTTOM SECTION: Terms (left) + Totals (right) ── */}
          <View style={s.bottomSection}>
            {/* Left: Terms + Amount in Words */}
            <View style={s.termsCol}>
              {(cx.notes.showOrderNotes || cx.footer.showFooterNotes) ? (
                <>
                  <Text style={s.termsLabel}>Terms and Conditions</Text>
                  {cx.footer.showFooterNotes && cx.footer.footerNotes ? (
                    <Text style={s.termsText}>{cx.footer.footerNotes}</Text>
                  ) : (
                    <Text style={s.termsText}>Terms and conditions apply.</Text>
                  )}
                </>
              ) : null}
              {cx.notes.showOrderNotes && (invoice as any).orderNote ? (
                <Text style={s.termsText}>{(invoice as any).orderNote}</Text>
              ) : null}
              {showTotalInWords ? (
                <>
                  <Text style={s.termsLabel}>Amount in Words:</Text>
                  <Text style={s.amtWordsText}>{invoice.amountInWords}</Text>
                </>
              ) : null}
              <Text style={s.eoeText}>E. &amp; O.E</Text>
              {cx.notes.showThankYou && cx.notes.thankYouNote ? (
                <Text style={[s.termsText, { marginTop: 4 }]}>{cx.notes.thankYouNote}</Text>
              ) : null}
              {cx.notes.showContactEmail && cx.notes.contactEmail ? (
                <Text style={[s.termsText, { marginTop: 2 }]}>
                  {cx.notes.emailPrefixText} {cx.notes.contactEmail}
                </Text>
              ) : null}
            </View>

            {/* Right: Totals */}
            <View style={s.totalsCol}>
              {invoice.discountAmount > 0 && rv.discount !== false ? (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Discount:</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.totalVal}>{formatRs(invoice.discountAmount)}</Text>
                    <Text style={{ fontSize: 6.5, color: "#888" }}>Custom discount</Text>
                  </View>
                </View>
              ) : null}
              {rv.beforeTax !== false ? (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Amount before Tax:</Text>
                  <Text style={s.totalVal}>{formatRs(invoice.taxableAmount)}</Text>
                </View>
              ) : null}
              {rv.totalTax !== false ? (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Tax Amount:</Text>
                  <Text style={s.totalVal}>{formatRs(totalTax)}</Text>
                </View>
              ) : null}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total Amount After Tax:</Text>
                <Text style={s.totalVal}>{formatRs(amountAfterTax)}</Text>
              </View>
              {shippingAmt > 0 && rv.shippingAmount !== false ? (
                <>
                  <View style={s.totalRow}>
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
              ) : null}
              {showRoundOff ? (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Round Off:</Text>
                  <Text style={s.totalVal}>
                    {roundOffAmt >= 0
                      ? `+${formatRs(roundOffAmt)}`
                      : `-${formatRs(Math.abs(roundOffAmt))}`}
                  </Text>
                </View>
              ) : null}
              {rv.grandTotal !== false ? (
                <View style={s.grandBox}>
                  <Text style={s.grandLabel}>Total</Text>
                  <Text style={s.grandVal}>{formatRs(grandTotalDisplay)}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ── FOOTER AREA ── */}
          <View style={s.footerArea}>
            {/* Social links row */}
            {socialLinks.length > 0 ? (
              <View style={s.socialRow}>
                {socialLinks.map((l) => <Text key={l} style={s.socialText}>{l}</Text>)}
              </View>
            ) : null}

            {/* Signature */}
            {showSignature ? (
              <View style={s.signatureRow}>
                <Text style={s.signatureLabel}>Authorised Signatory</Text>
                {shop.signatureUrl ? <Image src={shop.signatureUrl} style={s.signatureImg} /> : <View style={{ width: 100, height: 32 }} />}
              </View>
            ) : null}
          </View>

          {/* ── E-INVOICE / IRN ── */}
          {invoice.irn && invoice.irnStatus === "GENERATED" ? (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderTop: BORDER,
                marginHorizontal: 16,
                paddingTop: 8,
                marginBottom: 8,
              }}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ fontSize: 7, color: "#999", marginBottom: 2 }}>E-INVOICE</Text>
                <Text style={{ fontSize: 7, color: "#333", marginBottom: 1 }}>IRN: {invoice.irn}</Text>
                {invoice.ackNo ? (
                  <Text style={{ fontSize: 7, color: "#555" }}>ACK No: {invoice.ackNo}</Text>
                ) : null}
                {invoice.ackDate ? (
                  <Text style={{ fontSize: 7, color: "#555" }}>ACK Date: {invoice.ackDate}</Text>
                ) : null}
              </View>
              {cx.overview.showQrCode && invoice.qrCodeDataUrl ? (
                <Image src={invoice.qrCodeDataUrl} style={{ width: 60, height: 60 }} />
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ── PAGE FOOTER (fixed, outside border) ── */}
        <View style={s.pageFooter} fixed>
          <Text style={s.pageFooterText}>
            {shop.settings?.footerText || "Thank you for your business!"}
          </Text>
          <Text style={s.pageFooterText}>
            {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
