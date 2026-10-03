import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { InvoiceData, CopyType } from "./invoice-pdf-types";
import { makeFormatters } from "./invoice-pdf-types";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";
import { renderCustomFields } from "~/components/pdf-custom-fields";
import { placeOfSupplyText, reverseChargeText } from "~/lib/pdf-helpers";

const C = "#1C1C1E"; // charcoal
const LIGHT = "#F5F5F5";
const ACCENT = "#FF6B35"; // orange accent

const makeStyles = (base: string, bold: string, boldItalic: string, bodySize = 9, headingSize = 13) =>
  StyleSheet.create({
  page: { fontFamily: base, fontSize: bodySize, color: "#222", paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0 },
  topBar: { backgroundColor: C, paddingHorizontal: 30, paddingVertical: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 0 },
  logo: { width: 70, height: 35, objectFit: "contain", marginBottom: 6 },
  companyName: { fontSize: headingSize, fontFamily: bold, color: "#FFFFFF" },
  companyDetail: { fontSize: 7.5, color: "#AAAAAA", marginTop: 2 },
  invoiceTitle: { fontSize: 22, fontFamily: bold, color: "#FFFFFF", textAlign: "right" },
  invoiceMeta: { fontSize: 8, color: "#CCCCCC", textAlign: "right", marginTop: 3 },
  accentBadge: { backgroundColor: ACCENT, color: "#fff", fontSize: 7.5, fontFamily: bold, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, alignSelf: "flex-end" },
  body: { paddingHorizontal: 30, paddingTop: 16 },
  twoCol: { flexDirection: "row", gap: 10, marginBottom: 14 },
  colBox: { flex: 1, backgroundColor: LIGHT, padding: 9 },
  colTitle: { fontSize: 7, fontFamily: bold, color: C, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, borderBottom: `1.5px solid ${C}`, paddingBottom: 3 },
  colValue: { fontSize: 9, fontFamily: bold, marginBottom: 2 },
  colDetail: { fontSize: 8, color: "#555", marginBottom: 1 },
  table: { marginBottom: 12 },
  tableHead: { flexDirection: "row", backgroundColor: C, paddingHorizontal: 4, paddingVertical: 5 },
  tableRow: { flexDirection: "row", paddingHorizontal: 4, paddingVertical: 4, borderBottom: `0.5px solid #DDDDDD` },
  th: { color: "#fff", fontSize: 7, fontFamily: bold },
  td: { fontSize: 8 },
  wSno: { width: "4%" }, wItem: { width: "28%" }, wHsn: { width: "8%" },
  wQty: { width: "6%", textAlign: "right" }, wRate: { width: "10%", textAlign: "right" },
  wDiscount: { width: "8%", textAlign: "right" }, wGstRate: { width: "6%", textAlign: "right" },
  wTax: { width: "8%", textAlign: "right" }, wTax2: { width: "16%", textAlign: "right" },
  wTaxable: { width: "10%", textAlign: "right" }, wAmt: { width: "10%", textAlign: "right" },
  totalSection: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  totalBox: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 4 },
  totalLabel: { fontSize: 8, color: "#555" },
  totalVal: { fontSize: 8 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: C, paddingVertical: 6, paddingHorizontal: 4, marginTop: 3 },
  grandLabel: { fontSize: 9.5, fontFamily: bold, color: "#fff" },
  grandVal: { fontSize: 9.5, fontFamily: bold, color: ACCENT },
  amtWords: { fontSize: 8, fontFamily: boldItalic, color: "#333", backgroundColor: LIGHT, padding: 6, marginBottom: 12 },
  footer: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", borderTop: `1.5px solid ${C}`, paddingTop: 6 },
  footerText: { fontSize: 7, color: "#888" },
});

export function InvoicePDFTemplate2({ invoice, copyType = "Original", customization }: { invoice: InvoiceData; copyType?: CopyType; customization?: TemplateCustomizationSettings }) {
  const { shop, lineItems } = invoice;
  const settings = shop.settings;
  const { formatDate, formatRs } = makeFormatters(settings);
  const isIGST = invoice.taxType === "IGST";
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold, fonts.boldItalic, cx.branding.bodySize, cx.branding.headingSize);
  const showHsn = cx.lineItems.columnVisibility.hsCode !== false && settings?.showHsnCode !== false;
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
  const billToLabel = cx.labels.billTo || "Billed To";
  const titleText = invoice.invoiceType === "CREDIT_NOTE" ? "CREDIT NOTE" : (cx.overview.invoiceTitleLabel || cx.labels.taxInvoiceTitle || "TAX INVOICE");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.topBar}>
          <View style={{ flex: 1 }}>
            {showLogo ? <Image src={shop.logoUrl!} style={{ ...s.logo, width: cx.overview.logoWidth || 70 }} /> : null}
            <Text style={s.companyName}>{shop.businessName || "Business Name"}</Text>
            {showSupplierGstin ? <Text style={s.companyDetail}>GSTIN: {shop.gstin}</Text> : null}
            {(cx.address.supplier.show && cx.address.supplier.showAddress && shop.address) ? <Text style={s.companyDetail}>{shop.address}</Text> : null}
            {(cx.address.supplier.show && (shop.city || shop.state)) ? <Text style={s.companyDetail}>{[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}</Text> : null}
            {(cx.address.supplier.show && cx.address.supplier.showPhone && shop.phone) ? <Text style={s.companyDetail}>Ph: {shop.phone}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {cx.overview.showTitle ? <Text style={s.invoiceTitle}>{titleText}</Text> : null}
            <Text style={s.invoiceMeta}>{copyType}</Text>
            {cx.overview.showInvoiceNumber ? <Text style={s.invoiceMeta}>{invoice.invoiceNumber}</Text> : null}
            {cx.overview.showOrderNumber && (invoice as any).orderName ? <Text style={s.invoiceMeta}>Order No.: {(invoice as any).orderName}</Text> : null}
            {cx.overview.showOrderDate ? <Text style={s.invoiceMeta}>Date: {formatDate(invoice.invoiceDate)}</Text> : null}
            <Text style={s.accentBadge}>{invoice.supplyType} · {isIGST ? igstLabel : `${cgstLabel}+${sgstLabel}`}</Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.twoCol}>
            {showBilling && (
              <View style={s.colBox}>
                <Text style={s.colTitle}>{billToLabel}</Text>
                {cx.address.billing.showName ? <Text style={s.colValue}>{invoice.buyerName || "Customer"}</Text> : null}
                {(cx.address.billing.showAddress && invoice.buyerAddress) ? <Text style={s.colDetail}>{invoice.buyerAddress}</Text> : null}
                {(invoice.buyerCity || invoice.buyerState) ? <Text style={s.colDetail}>{[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}</Text> : null}
                {(cx.address.billing.showGstin && invoice.buyerGstin) ? <Text style={s.colDetail}>GSTIN: {invoice.buyerGstin}</Text> : null}
                {(cx.address.billing.showPhone && invoice.buyerPhone) ? <Text style={s.colDetail}>Ph: {invoice.buyerPhone}</Text> : null}
                {(cx.address.billing.showEmail && invoice.buyerEmail) ? <Text style={s.colDetail}>{invoice.buyerEmail}</Text> : null}
              </View>
            )}
            <View style={s.colBox}>
              <Text style={s.colTitle}>Invoice Details</Text>
              {cx.overview.showPlaceOfSupply ? <Text style={s.colDetail}>{cx.overview.placeOfSupplyLabel || "Place of Supply"}: {placeOfSupplyText(invoice)}</Text> : null}
              <Text style={s.colDetail}>Tax Type: {isIGST ? "IGST (Inter-state)" : "CGST + SGST (Intra-state)"}</Text>
              <Text style={s.colDetail}>Supply: {invoice.supplyType === "B2B" ? "B2B (Registered)" : "B2C (Unregistered)"}</Text>
              <Text style={s.colDetail}>Reverse Charge: {reverseChargeText(invoice)}</Text>
              {(cx.overview.showPaymentGateway && (invoice as any).paymentMethod) ? <Text style={s.colDetail}>{cx.overview.paymentLabel || "Payment"}: {(invoice as any).paymentMethod}</Text> : null}
              {(cx.overview.showOrderTags && (invoice as any).orderTags) ? <Text style={s.colDetail}>Tags: {(invoice as any).orderTags}</Text> : null}
            </View>
          </View>

          {renderCustomFields(invoice, fonts.base, fonts.bold)}

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
              {isIGST ? <Text style={[s.th, s.wTax2]}>{igstLabel}</Text> : <><Text style={[s.th, s.wTax]}>{cgstLabel}</Text><Text style={[s.th, s.wTax]}>{sgstLabel}</Text></>}
              <Text style={[s.th, s.wAmt]}>Total</Text>
            </View>
            {lineItems.map((item, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.td, s.wSno]}>{i + 1}</Text>
                <View style={{ width: "28%" }}>
                  <Text style={{ fontSize: 8 }}>{item.productName}</Text>
                  {item.variantName ? <Text style={{ fontSize: 7, color: "#888" }}>{item.variantName}</Text> : null}
                </View>
                {showHsn && <Text style={[s.td, s.wHsn, { color: "#666" }]}>{item.hsnCode || "-"}</Text>}
                <View style={{ width: "6%", alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 8 }}>{item.quantity}</Text>
                  {item.unit ? <Text style={{ fontSize: 6, color: "#888" }}>{item.unit}</Text> : null}
                </View>
                <Text style={[s.td, s.wRate]}>{formatRs(item.unitPrice)}</Text>
                {showDiscount && <Text style={[s.td, s.wDiscount]}>{item.discount > 0 ? formatRs(item.discount) : "-"}</Text>}
                <Text style={[s.td, s.wTaxable]}>{formatRs(item.taxableValue)}</Text>
                {showGstRate && <Text style={[s.td, s.wGstRate]}>{isIGST ? item.igstRate : (item.cgstRate + item.sgstRate)}%</Text>}
                {isIGST
                  ? <Text style={[s.td, s.wTax2]}>{showGstRate ? formatRs(item.igstAmount) : `${item.igstRate}%\n${formatRs(item.igstAmount)}`}</Text>
                  : <><Text style={[s.td, s.wTax]}>{showGstRate ? formatRs(item.cgstAmount) : `${item.cgstRate}%\n${formatRs(item.cgstAmount)}`}</Text><Text style={[s.td, s.wTax]}>{showGstRate ? formatRs(item.sgstAmount) : `${item.sgstRate}%\n${formatRs(item.sgstAmount)}`}</Text></>}
                <Text style={[s.td, s.wAmt, { fontFamily: fonts.bold }]}>{formatRs(item.totalAmount)}</Text>
              </View>
            ))}
          </View>

          <View style={s.totalSection}>
            <View style={s.totalBox}>
              <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalVal}>{formatRs(invoice.subTotal)}</Text></View>
              {(rv.discount !== false && invoice.discountAmount > 0) ? <View style={s.totalRow}><Text style={s.totalLabel}>Discount</Text><Text style={s.totalVal}>- {formatRs(invoice.discountAmount)}</Text></View> : null}
              {rv.beforeTax !== false ? <View style={[s.totalRow, { borderTop: `0.5px solid #DDD`, marginTop: 2 }]}><Text style={s.totalLabel}>Taxable Amount</Text><Text style={s.totalVal}>{formatRs(invoice.taxableAmount)}</Text></View> : null}
              {rv.totalTax !== false ? (isIGST
                ? <View style={s.totalRow}><Text style={s.totalLabel}>{igstLabel}</Text><Text style={s.totalVal}>{formatRs(invoice.igstAmount)}</Text></View>
                : <><View style={s.totalRow}><Text style={s.totalLabel}>{cgstLabel}</Text><Text style={s.totalVal}>{formatRs(invoice.cgstAmount)}</Text></View><View style={s.totalRow}><Text style={s.totalLabel}>{sgstLabel}</Text><Text style={s.totalVal}>{formatRs(invoice.sgstAmount)}</Text></View></>) : null}
              {(rv.shippingAmount !== false && (invoice.shippingAmount ?? 0) > 0) ? <View style={[s.totalRow, { borderTop: `0.5px solid #DDD`, marginTop: 2 }]}><Text style={s.totalLabel}>Shipping</Text><Text style={s.totalVal}>{formatRs(invoice.shippingAmount!)}</Text></View> : null}
              {(rv.shippingTax !== false && (invoice.shippingTax ?? 0) > 0) ? <View style={s.totalRow}><Text style={s.totalLabel}>Shipping GST</Text><Text style={s.totalVal}>{formatRs(invoice.shippingTax!)}</Text></View> : null}
              {showRoundOff ? <View style={s.totalRow}><Text style={s.totalLabel}>Round Off</Text><Text style={s.totalVal}>{roundOffAmt >= 0 ? `+${formatRs(roundOffAmt)}` : `-${formatRs(Math.abs(roundOffAmt))}`}</Text></View> : null}
              {rv.grandTotal !== false ? <View style={s.grandRow}><Text style={s.grandLabel}>Grand Total</Text><Text style={s.grandVal}>{formatRs(grandTotalDisplay)}</Text></View> : null}
            </View>
          </View>

          {showTotalInWords ? <Text style={s.amtWords}>{cx.labels.totalInWordsLabel || "In Words"}: {invoice.amountInWords}</Text> : null}
          {(cx.notes.showOrderNotes && (invoice as any).orderNote) ? (
            <View style={{ backgroundColor: "#f9f9f9", border: "1px solid #e8e8e8", padding: 8, marginBottom: 10, borderRadius: 3 }}>
              <Text style={{ fontSize: 7.5, fontFamily: fonts.bold, color: "#333", marginBottom: 3 }}>{cx.notes.orderNoteTitle || "Order Note"}</Text>
              <Text style={{ fontSize: 8, color: "#555" }}>{(invoice as any).orderNote}</Text>
            </View>
          ) : null}
          {(cx.notes.showThankYou && cx.notes.thankYouNote) ? (
            <View style={{ backgroundColor: "#f9f9f9", padding: 8, marginBottom: 10 }}>
              <Text style={{ fontSize: 8, color: "#555" }}>{cx.notes.thankYouNote}</Text>
            </View>
          ) : null}
          {(cx.notes.showContactEmail && cx.notes.contactEmail) ? (
            <Text style={{ fontSize: 8, color: "#555", marginBottom: 8 }}>{cx.notes.emailPrefixText} {cx.notes.contactEmail}</Text>
          ) : null}
          {(cx.footer.showFooterNotes && cx.footer.footerNotes) ? (
            <View style={{ backgroundColor: "#f9f9f9", border: "1px solid #e8e8e8", padding: 8, marginBottom: 10, borderRadius: 3 }}>
              <Text style={{ fontSize: 8, color: "#555" }}>{cx.footer.footerNotes}</Text>
            </View>
          ) : null}
          {(cx.footer.showWebsite || cx.footer.showFacebook || cx.footer.showInstagram || cx.footer.showX) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              {cx.footer.showWebsite && cx.footer.websiteUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>{cx.footer.websiteLabel || "Website"}: {cx.footer.websiteUrl}</Text> : null}
              {cx.footer.showFacebook && cx.footer.facebookUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>Facebook: {cx.footer.facebookUrl}</Text> : null}
              {cx.footer.showInstagram && cx.footer.instagramUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>Instagram: {cx.footer.instagramUrl}</Text> : null}
              {cx.footer.showX && cx.footer.xUrl ? <Text style={{ fontSize: 7.5, color: "#555" }}>X: {cx.footer.xUrl}</Text> : null}
            </View>
          ) : null}
          {showSignature ? (
            <View style={{ alignItems: "flex-end", marginBottom: 20 }}>
              {shop.businessName ? <Text style={{ fontSize: 7.5, color: "#AAA", marginBottom: 4 }}>For {shop.businessName}</Text> : null}
              {shop.signatureUrl ? <Image src={shop.signatureUrl} style={{ width: 100, height: 36, objectFit: "contain" }} /> : <View style={{ width: 100, height: 32 }} />}
              <Text style={{ fontSize: 7.5, color: "#AAA", marginTop: 3 }}>Authorized Signatory</Text>
            </View>
          ) : null}
        </View>

        {invoice.irn && invoice.irnStatus === "GENERATED" && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderTop: "0.5px solid #DDD", paddingTop: 8, marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 7, color: "#888", marginBottom: 2 }}>E-INVOICE</Text>
              <Text style={{ fontSize: 7, color: "#333", marginBottom: 1 }}>IRN: {invoice.irn}</Text>
              {invoice.ackNo   && <Text style={{ fontSize: 7, color: "#555" }}>ACK No: {invoice.ackNo}</Text>}
              {invoice.ackDate && <Text style={{ fontSize: 7, color: "#555" }}>ACK Date: {invoice.ackDate}</Text>}
            </View>
            {cx.overview.showQrCode && invoice.qrCodeDataUrl && <Image src={invoice.qrCodeDataUrl} style={{ width: 60, height: 60 }} />}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{cx.footer.showFooterNotes && cx.footer.footerNotes ? cx.footer.footerNotes : (settings?.footerText || "Thank you for your business!")}</Text>
          <Text style={s.footerText}>{invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}</Text>
        </View>
      </Page>
    </Document>
  );
}
