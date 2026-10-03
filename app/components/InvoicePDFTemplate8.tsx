import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { InvoiceData, CopyType } from "./invoice-pdf-types";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";
import { placeOfSupplyText, stateCodeText, reverseChargeText } from "~/lib/pdf-helpers";

// Ledger — black/dark borders, formal accounting layout, HSN/SAC tax summary table
const C = "#1A1A1A";
const BORDER = "#333333";

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: {
    fontFamily: base,
    fontSize: bodySize,
    color: "#1A1A1A",
    paddingTop: 24,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  // Top header: logo left, title center, copy right
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: `1px solid ${BORDER}`,
  },
  logoBlock: {
    flex: 1,
  },
  logo: {
    height: 40,
    objectFit: "contain",
    marginBottom: 4,
  },
  companyName: {
    fontSize: headingSize,
    fontFamily: bold,
    color: C,
    marginBottom: 2,
  },
  companyDetail: {
    fontSize: 7.5,
    color: "#444",
    marginBottom: 1,
  },
  titleBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  invoiceTitle: {
    fontSize: headingSize + 2,
    fontFamily: bold,
    color: C,
    textAlign: "center",
  },
  copyBlock: {
    flex: 1,
    alignItems: "flex-end",
  },
  copyText: {
    fontSize: 8,
    fontFamily: bold,
    color: "#444",
    border: `0.5px solid ${BORDER}`,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // Info table (invoice meta)
  infoTable: {
    flexDirection: "row",
    border: `0.5px solid ${BORDER}`,
    marginBottom: 8,
  },
  infoCol: {
    flex: 1,
    borderRight: `0.5px solid ${BORDER}`,
  },
  infoColLast: {
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    borderBottom: `0.5px solid ${BORDER}`,
    minHeight: 16,
  },
  infoRowLast: {
    flexDirection: "row",
    minHeight: 16,
  },
  infoLabel: {
    fontSize: 7,
    color: "#666",
    padding: "3 5",
    width: 72,
    borderRight: `0.5px solid ${BORDER}`,
  },
  infoValue: {
    fontSize: 7.5,
    color: "#1A1A1A",
    padding: "3 5",
    flex: 1,
  },
  // Billing / shipping address row
  addressRow: {
    flexDirection: "row",
    border: `0.5px solid ${BORDER}`,
    marginBottom: 8,
  },
  addressCol: {
    flex: 1,
    padding: 7,
    borderRight: `0.5px solid ${BORDER}`,
  },
  addressColLast: {
    flex: 1,
    padding: 7,
  },
  addressTitle: {
    fontSize: 7.5,
    fontFamily: bold,
    color: C,
    textTransform: "uppercase",
    marginBottom: 4,
    paddingBottom: 3,
    borderBottom: `0.5px solid ${BORDER}`,
  },
  addressName: {
    fontSize: 8,
    fontFamily: bold,
    marginBottom: 2,
  },
  addressDetail: {
    fontSize: 7.5,
    color: "#444",
    marginBottom: 1,
  },
  // Line items table
  table: {
    border: `0.5px solid ${BORDER}`,
    marginBottom: 8,
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C,
    padding: "4 4",
  },
  tableRow: {
    flexDirection: "row",
    padding: "3 4",
    borderBottom: `0.5px solid #CCCCCC`,
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: "3 4",
    backgroundColor: "#F7F7F7",
    borderBottom: `0.5px solid #CCCCCC`,
  },
  th: {
    color: "#FFFFFF",
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
  // Amount in words row (spans full width inside table)
  amtWordsRow: {
    flexDirection: "row",
    padding: "5 8",
    borderTop: `0.5px solid ${BORDER}`,
    backgroundColor: "#F7F7F7",
  },
  amtWordsText: {
    fontSize: 8,
    fontFamily: boldItalic,
    color: "#333",
  },
  // Bottom section: HSN summary (left) + Totals (right)
  bottomRow: {
    flexDirection: "row",
    border: `0.5px solid ${BORDER}`,
    marginBottom: 8,
  },
  hsnCol: {
    flex: 1,
    borderRight: `0.5px solid ${BORDER}`,
    padding: 7,
  },
  hsnTitle: {
    fontSize: 7.5,
    fontFamily: bold,
    color: C,
    textTransform: "uppercase",
    marginBottom: 5,
    paddingBottom: 3,
    borderBottom: `0.5px solid ${BORDER}`,
  },
  hsnTable: {
    border: `0.5px solid ${BORDER}`,
    marginBottom: 6,
  },
  hsnTableHead: {
    flexDirection: "row",
    backgroundColor: "#444444",
    padding: "3 4",
  },
  hsnTh: {
    color: "#fff",
    fontSize: 6.5,
    fontFamily: bold,
    flex: 1,
    textAlign: "center" as const,
  },
  hsnRow: {
    flexDirection: "row",
    padding: "3 4",
    borderTop: `0.5px solid #CCCCCC`,
  },
  hsnTd: {
    fontSize: 7,
    flex: 1,
    textAlign: "center" as const,
    color: "#333",
  },
  termsSection: {
    marginTop: 6,
  },
  termsLabel: {
    fontSize: 7.5,
    fontFamily: bold,
    color: "#333",
    marginBottom: 2,
  },
  termsText: {
    fontSize: 7.5,
    color: "#555",
    marginBottom: 2,
  },
  totalsCol: {
    width: 220,
    padding: 7,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottom: `0.5px solid #EEEEEE`,
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
    color: "#FFFFFF",
  },
  grandVal: {
    fontSize: 9,
    fontFamily: bold,
    color: "#FFFFFF",
  },
  // Footer
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
    color: "#1A1A1A",
    textAlign: "center",
    marginBottom: 6,
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "flex-end",
    gap: 10,
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
  pageFooter: {
    position: "absolute",
    bottom: 14,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `0.5px solid #CCCCCC`,
    paddingTop: 4,
  },
  pageFooterText: {
    fontSize: 7,
    color: "#888",
  },
});

export function InvoicePDFTemplate8({
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

  // ── HSN/SAC Tax Summary groups ──
  const hsnGroups = lineItems.reduce(
    (acc, item) => {
      const rate = isIGST ? item.igstRate : item.cgstRate + item.sgstRate;
      const key = item.hsnCode || "-";
      const existing = acc.find((g) => g.hsn === key && g.rate === rate);
      if (existing) {
        existing.cgstAmt += item.cgstAmount;
        existing.sgstAmt += item.sgstAmount;
        existing.igstAmt += item.igstAmount;
      } else {
        acc.push({
          hsn: key,
          rate,
          cgstRate: item.cgstRate,
          sgstRate: item.sgstRate,
          igstRate: item.igstRate,
          cgstAmt: item.cgstAmount,
          sgstAmt: item.sgstAmount,
          igstAmt: item.igstAmount,
        });
      }
      return acc;
    },
    [] as Array<{
      hsn: string;
      rate: number;
      cgstRate: number;
      sgstRate: number;
      igstRate: number;
      cgstAmt: number;
      sgstAmt: number;
      igstAmt: number;
    }>
  );

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* ── TOP HEADER ROW ── */}
        <View style={s.topRow}>
          {/* Left: Logo + Supplier info */}
          <View style={s.logoBlock}>
            {showLogo ? (
              <Image
                src={shop.logoUrl!}
                style={{ ...s.logo, width: cx.overview.logoWidth || 70 }}
              />
            ) : null}
            <Text style={s.companyName}>{shop.businessName || "Supplier"}</Text>
            {showSupplierGstin ? (
              <Text style={s.companyDetail}>GSTIN: {shop.gstin}</Text>
            ) : null}
            {cx.address.supplier.show && cx.address.supplier.showAddress && shop.address ? (
              <Text style={s.companyDetail}>{shop.address}</Text>
            ) : null}
            {cx.address.supplier.show && (shop.city || shop.state) ? (
              <Text style={s.companyDetail}>
                {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {cx.address.supplier.show && cx.address.supplier.showPhone && shop.phone ? (
              <Text style={s.companyDetail}>Ph: {shop.phone}</Text>
            ) : null}
            {shop.email ? (
              <Text style={s.companyDetail}>{shop.email}</Text>
            ) : null}
          </View>

          {/* Center: Invoice Title */}
          <View style={s.titleBlock}>
            {cx.overview.showTitle ? (
              <Text style={s.invoiceTitle}>{titleText}</Text>
            ) : null}
          </View>

          {/* Right: Copy type */}
          <View style={s.copyBlock}>
            <Text style={s.copyText}>{copyType}</Text>
          </View>
        </View>

        {/* ── INVOICE META TABLE ── */}
        <View style={s.infoTable}>
          {/* Left column */}
          <View style={s.infoCol}>
            {cx.overview.showInvoiceNumber ? (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>{cx.overview.invoiceNumberLabel || "Invoice No"}:</Text>
                <Text style={[s.infoValue, { fontFamily: fonts.bold }]}>{invoice.invoiceNumber}</Text>
              </View>
            ) : null}
            {cx.overview.showOrderDate ? (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Invoice Date:</Text>
                <Text style={s.infoValue}>{formatDate(invoice.invoiceDate)}</Text>
              </View>
            ) : null}
            {cx.overview.showOrderNumber && (invoice as any).orderName ? (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Order No:</Text>
                <Text style={s.infoValue}>{(invoice as any).orderName}</Text>
              </View>
            ) : null}
            {cx.overview.showOrderDate && (invoice as any).orderDate ? (
              <View style={s.infoRowLast}>
                <Text style={s.infoLabel}>Order Date:</Text>
                <Text style={s.infoValue}>{formatDate((invoice as any).orderDate)}</Text>
              </View>
            ) : (
              <View style={s.infoRowLast}>
                <Text style={s.infoLabel}>Supply Type:</Text>
                <Text style={s.infoValue}>{invoice.supplyType}</Text>
              </View>
            )}
          </View>
          {/* Right column */}
          <View style={s.infoColLast}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Reverse Charge:</Text>
              <Text style={s.infoValue}>{reverseChargeText(invoice)}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Date of Supply:</Text>
              <Text style={s.infoValue}>{formatDate(invoice.invoiceDate)}</Text>
            </View>
            {cx.overview.showPlaceOfSupply ? (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>{cx.overview.placeOfSupplyLabel || "Place of Supply"}:</Text>
                <Text style={s.infoValue}>{placeOfSupplyText(invoice)}</Text>
              </View>
            ) : null}
            {cx.address.billing.showStateCode && invoice.buyerState ? (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>State Code:</Text>
                <Text style={s.infoValue}>{stateCodeText(invoice)}</Text>
              </View>
            ) : null}
            {cx.overview.showPaymentGateway && (invoice as any).paymentMethod ? (
              <View style={s.infoRowLast}>
                <Text style={s.infoLabel}>{cx.overview.paymentLabel || "Payment"}:</Text>
                <Text style={s.infoValue}>{(invoice as any).paymentMethod}</Text>
              </View>
            ) : (
              <View style={s.infoRowLast}>
                <Text style={s.infoLabel}>Tax Type:</Text>
                <Text style={s.infoValue}>
                  {isIGST ? igstLabel : `${cgstLabel} + ${sgstLabel}`}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── BILLING / SHIPPING ADDRESS ── */}
        <View style={s.addressRow}>
          {/* Billed To */}
          <View style={s.addressCol}>
            <Text style={s.addressTitle}>{billToLabel}</Text>
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
                {invoice.reverseCharge ? (
                  <Text style={[s.addressDetail, { color: "#e53935" }]}>
                    Reverse Charge Applicable
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          {/* Ship To */}
          <View style={s.addressColLast}>
            <Text style={s.addressTitle}>{shipToLabel}</Text>
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
            ) : null}
          </View>
        </View>

        {/* Custom fields */}
        {renderCustomFields(invoice, fonts.base, fonts.bold)}

        {/* ── LINE ITEMS TABLE ── */}
        <View style={s.table}>
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
              <Text style={[s.td, s.wSno, { color: "#888" }]}>{i + 1}</Text>
              <View style={{ width: "24%" }}>
                <Text style={{ fontSize: 7.5 }}>{item.productName}</Text>
                {item.variantName ? (
                  <Text style={{ fontSize: 6.5, color: "#888" }}>{item.variantName}</Text>
                ) : null}
              </View>
              {showHsn && (
                <Text style={[s.td, s.wHsn, { color: "#666" }]}>{item.hsnCode || "-"}</Text>
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
                <Text style={[s.td, s.wGstRate, { color: "#444" }]}>
                  {isIGST ? item.igstRate : item.cgstRate + item.sgstRate}%
                </Text>
              )}
              {isIGST ? (
                <Text style={[s.td, s.wTax2, { color: "#444" }]}>
                  {showGstRate
                    ? formatRs(item.igstAmount)
                    : `${item.igstRate}%\n${formatRs(item.igstAmount)}`}
                </Text>
              ) : (
                <>
                  <Text style={[s.td, s.wTax, { color: "#444" }]}>
                    {showGstRate
                      ? formatRs(item.cgstAmount)
                      : `${item.cgstRate}%\n${formatRs(item.cgstAmount)}`}
                  </Text>
                  <Text style={[s.td, s.wTax, { color: "#444" }]}>
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

          {/* Amount in words row inside table */}
          {showTotalInWords ? (
            <View style={s.amtWordsRow}>
              <Text style={s.amtWordsText}>
                {cx.labels.totalInWordsLabel
                  ? `${cx.labels.totalInWordsLabel}: `
                  : "Amount in Words: "}
                {invoice.amountInWords}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── BOTTOM SECTION: HSN/SAC summary (left) + Totals (right) ── */}
        <View style={s.bottomRow}>
          {/* Left: HSN/SAC table + Terms */}
          <View style={s.hsnCol}>
            <Text style={s.hsnTitle}>HSN/SAC Tax Summary</Text>

            <View style={s.hsnTable}>
              <View style={s.hsnTableHead}>
                <Text style={s.hsnTh}>HSN/SAC</Text>
                {isIGST ? (
                  <>
                    <Text style={s.hsnTh}>{igstLabel}%</Text>
                    <Text style={s.hsnTh}>Amt</Text>
                  </>
                ) : (
                  <>
                    <Text style={s.hsnTh}>{cgstLabel}%</Text>
                    <Text style={s.hsnTh}>Amt</Text>
                    <Text style={s.hsnTh}>{sgstLabel}%</Text>
                    <Text style={s.hsnTh}>Amt</Text>
                  </>
                )}
                <Text style={s.hsnTh}>Total</Text>
              </View>

              {hsnGroups.map((g, i) => (
                <View key={i} style={s.hsnRow}>
                  <Text style={s.hsnTd}>{g.hsn}</Text>
                  {isIGST ? (
                    <>
                      <Text style={s.hsnTd}>{g.igstRate}%</Text>
                      <Text style={s.hsnTd}>{formatRs(g.igstAmt)}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.hsnTd}>{g.cgstRate}%</Text>
                      <Text style={s.hsnTd}>{formatRs(g.cgstAmt)}</Text>
                      <Text style={s.hsnTd}>{g.sgstRate}%</Text>
                      <Text style={s.hsnTd}>{formatRs(g.sgstAmt)}</Text>
                    </>
                  )}
                  <Text style={s.hsnTd}>
                    {formatRs(isIGST ? g.igstAmt : g.cgstAmt + g.sgstAmt)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Terms */}
            <View style={s.termsSection}>
              {cx.footer.showFooterNotes && cx.footer.footerNotes ? (
                <>
                  <Text style={s.termsLabel}>Terms and Conditions</Text>
                  <Text style={s.termsText}>{cx.footer.footerNotes}</Text>
                </>
              ) : null}
              {cx.notes.showOrderNotes && (invoice as any).orderNote ? (
                <Text style={s.termsText}>{(invoice as any).orderNote}</Text>
              ) : null}
              {cx.notes.showThankYou && cx.notes.thankYouNote ? (
                <Text style={s.termsText}>{cx.notes.thankYouNote}</Text>
              ) : null}
              {cx.notes.showContactEmail && cx.notes.contactEmail ? (
                <Text style={s.termsText}>
                  {cx.notes.emailPrefixText} {cx.notes.contactEmail}
                </Text>
              ) : null}
            </View>
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
                <Text style={s.totalLabel}>Total Amt before Tax:</Text>
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
              <Text style={s.totalLabel}>Total Amt After Tax:</Text>
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

        {/* ── SOCIAL + POWERED BY + SIGNATURE ── */}
        {socialLinks.length > 0 ? (
          <View style={s.socialRow}>
            {socialLinks.map((l) => <Text key={l} style={s.socialText}>{l}</Text>)}
          </View>
        ) : null}

        {showSignature ? (
          <View style={s.signatureRow}>
            <Text style={s.signatureLabel}>Authorised Signatory</Text>
            {shop.signatureUrl ? <Image src={shop.signatureUrl} style={s.signatureImg} /> : <View style={{ width: 100, height: 32 }} />}
          </View>
        ) : null}

        {/* ── E-INVOICE / IRN ── */}
        {invoice.irn && invoice.irnStatus === "GENERATED" ? (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              borderTop: `0.5px solid ${BORDER}`,
              paddingTop: 8,
              marginTop: 6,
              marginBottom: 12,
            }}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 7, color: "#888", marginBottom: 2 }}>E-INVOICE</Text>
              <Text style={{ fontSize: 7, color: "#333", marginBottom: 1 }}>
                IRN: {invoice.irn}
              </Text>
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

        {/* ── PAGE FOOTER (fixed) ── */}
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
