import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreditLineItem {
  productName: string;
  variantName: string | null;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxableValue: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

interface CreditShop {
  businessName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
}

interface CreditInvoice {
  invoiceNumber: string;
  invoiceDate: string | Date;
  orderName: string | null;
  taxType: string;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerCity: string | null;
  buyerState: string | null;
  buyerPincode: string | null;
  buyerGstin: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  placeOfSupply: string | null;
  totalAmount: number;
  amountInWords: string | null;
  shop: CreditShop;
  lineItems: CreditLineItem[];
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RED = "#C62828";
const LIGHT_RED = "#FFEBEE";
const DARK = "#1A1A1A";

const makeStyles = (base: string, bold: string, boldItalic: string) =>
  StyleSheet.create({
    page: {
      fontFamily: base,
      fontSize: 9,
      color: DARK,
      paddingTop: 30,
      paddingBottom: 40,
      paddingHorizontal: 32,
    },
    // ── Header ──────────────────────────────────────────────────────
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 18,
      paddingBottom: 12,
      borderBottom: `2pt solid ${RED}`,
    },
    logo: { width: 80, height: 40, objectFit: "contain", marginBottom: 4 },
    companyName: { fontSize: 13, fontFamily: bold, color: DARK },
    companyDetail: { fontSize: 8, color: "#555", marginTop: 2 },
    titleBlock: { alignItems: "flex-end" },
    creditNoteLabel: { fontSize: 9, fontFamily: bold, color: RED, textTransform: "uppercase", letterSpacing: 1.5 },
    creditNoteTitle: { fontSize: 22, fontFamily: bold, color: RED },
    creditNoteNumber: { fontSize: 9, color: "#444", marginTop: 3 },
    creditNoteDate: { fontSize: 8, color: "#666", marginTop: 2 },
    // ── Info Row ─────────────────────────────────────────────────────
    infoRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 14,
    },
    infoBox: {
      flex: 1,
      borderRadius: 3,
      border: `1pt solid #e0e0e0`,
      padding: 8,
    },
    infoBoxRed: {
      flex: 1,
      borderRadius: 3,
      border: `1pt solid ${RED}`,
      backgroundColor: LIGHT_RED,
      padding: 8,
    },
    infoTitle: {
      fontSize: 7,
      fontFamily: bold,
      color: RED,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 5,
    },
    infoValue: { fontSize: 8.5, fontFamily: bold, marginBottom: 2 },
    infoDetail: { fontSize: 8, color: "#555", marginBottom: 1 },
    // ── Table ────────────────────────────────────────────────────────
    table: { marginBottom: 10 },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: RED,
      padding: "4 4",
    },
    tableRow: {
      flexDirection: "row",
      padding: "4 4",
      borderBottom: "0.5pt solid #f0f0f0",
    },
    tableRowAlt: {
      flexDirection: "row",
      padding: "4 4",
      backgroundColor: LIGHT_RED,
      borderBottom: "0.5pt solid #f0e0e0",
    },
    th: { color: "#fff", fontSize: 7, fontFamily: bold },
    td: { fontSize: 8 },
    wNo: { width: "4%" },
    wItem: { width: "30%" },
    wHsn: { width: "10%" },
    wQty: { width: "8%", textAlign: "right" },
    wRate: { width: "10%", textAlign: "right" },
    wTaxable: { width: "12%", textAlign: "right" },
    wTax: { width: "14%", textAlign: "right" },
    wAmt: { width: "12%", textAlign: "right" },
    // ── Totals ───────────────────────────────────────────────────────
    totalsSection: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
    totalsBox: { width: 230 },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      padding: "3 4",
    },
    totalRowBorder: {
      flexDirection: "row",
      justifyContent: "space-between",
      padding: "3 4",
      borderTop: "0.5pt solid #e0e0e0",
    },
    totalLabel: { fontSize: 8, color: "#666" },
    totalValue: { fontSize: 8, color: DARK },
    grandRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: RED,
      padding: "5 4",
      borderRadius: 2,
      marginTop: 2,
    },
    grandLabel: { fontSize: 9, fontFamily: bold, color: "#fff" },
    grandVal: { fontSize: 9, fontFamily: bold, color: "#fff" },
    amtWords: {
      fontSize: 8,
      fontFamily: boldItalic,
      color: RED,
      backgroundColor: LIGHT_RED,
      border: `0.5pt solid ${RED}`,
      padding: 6,
      borderRadius: 3,
      marginBottom: 12,
    },
    // ── Notice ───────────────────────────────────────────────────────
    noticeBox: {
      backgroundColor: LIGHT_RED,
      border: `0.5pt solid ${RED}`,
      borderRadius: 3,
      padding: 8,
      marginBottom: 10,
    },
    noticeTitle: { fontSize: 7.5, fontFamily: bold, color: RED, marginBottom: 2 },
    noticeText: { fontSize: 7.5, color: "#555" },
    // ── Footer ───────────────────────────────────────────────────────
    footer: {
      position: "absolute",
      bottom: 20,
      left: 32,
      right: 32,
      borderTop: "0.5pt solid #e0e0e0",
      paddingTop: 6,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    footerText: { fontSize: 7, color: "#888" },
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRs(n: number): string {
  const abs = Math.abs(n);
  return `₹${abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CreditNotePDFTemplate({
  invoice,
  customization,
}: {
  invoice: CreditInvoice;
  customization?: TemplateCustomizationSettings;
}) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold, fonts.boldItalic);

  const { shop, lineItems } = invoice;
  const isIGST = invoice.taxType === "IGST";

  const totalTaxable = lineItems.reduce((sum, i) => sum + Math.abs(i.taxableValue), 0);
  const totalCgst = lineItems.reduce((sum, i) => sum + Math.abs(i.cgstAmount), 0);
  const totalSgst = lineItems.reduce((sum, i) => sum + Math.abs(i.sgstAmount), 0);
  const totalIgst = lineItems.reduce((sum, i) => sum + Math.abs(i.igstAmount), 0);
  const totalCredit = Math.abs(invoice.totalAmount);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            {(cx.overview.showLogo && shop.logoUrl) ? (
              <Image src={shop.logoUrl} style={s.logo} />
            ) : null}
            <Text style={s.companyName}>{shop.businessName || "Business Name"}</Text>
            {(shop.gstin && cx.overview.showSupplierGstin) ? (
              <Text style={s.companyDetail}>GSTIN: {shop.gstin}</Text>
            ) : null}
            {shop.address ? <Text style={s.companyDetail}>{shop.address}</Text> : null}
            {(shop.city || shop.state) ? (
              <Text style={s.companyDetail}>
                {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {shop.phone ? <Text style={s.companyDetail}>Ph: {shop.phone}</Text> : null}
          </View>
          <View style={s.titleBlock}>
            <Text style={s.creditNoteLabel}>Credit Note</Text>
            <Text style={s.creditNoteTitle}>CREDIT NOTE</Text>
            <Text style={s.creditNoteNumber}>No. {invoice.invoiceNumber}</Text>
            <Text style={s.creditNoteDate}>Date: {formatDate(invoice.invoiceDate)}</Text>
            {invoice.orderName ? (
              <Text style={[s.creditNoteDate, { marginTop: 3, color: RED }]}>
                Ref Order: {invoice.orderName}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── Bill To + Credit Details ── */}
        <View style={s.infoRow}>
          {/* Customer */}
          <View style={s.infoBox}>
            <Text style={s.infoTitle}>Customer Details</Text>
            {invoice.buyerName ? <Text style={s.infoValue}>{invoice.buyerName}</Text> : null}
            {invoice.buyerGstin ? <Text style={s.infoDetail}>GSTIN: {invoice.buyerGstin}</Text> : null}
            {invoice.buyerAddress ? <Text style={s.infoDetail}>{invoice.buyerAddress}</Text> : null}
            {(invoice.buyerCity || invoice.buyerState) ? (
              <Text style={s.infoDetail}>
                {[invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {invoice.buyerEmail ? <Text style={s.infoDetail}>{invoice.buyerEmail}</Text> : null}
            {invoice.buyerPhone ? <Text style={s.infoDetail}>Ph: {invoice.buyerPhone}</Text> : null}
          </View>

          {/* Credit Note Info */}
          <View style={s.infoBoxRed}>
            <Text style={s.infoTitle}>Credit Note Details</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
              <Text style={s.infoDetail}>Credit Note No.</Text>
              <Text style={[s.infoDetail, { fontFamily: fonts.bold }]}>{invoice.invoiceNumber}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
              <Text style={s.infoDetail}>Date</Text>
              <Text style={[s.infoDetail, { fontFamily: fonts.bold }]}>{formatDate(invoice.invoiceDate)}</Text>
            </View>
            {invoice.orderName ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                <Text style={s.infoDetail}>Ref. Order</Text>
                <Text style={[s.infoDetail, { fontFamily: fonts.bold }]}>{invoice.orderName}</Text>
              </View>
            ) : null}
            {invoice.placeOfSupply ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.infoDetail}>Place of Supply</Text>
                <Text style={[s.infoDetail, { fontFamily: fonts.bold }]}>{invoice.placeOfSupply}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Line Items Table ── */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.th, s.wNo]}>#</Text>
            <Text style={[s.th, s.wItem]}>Item Description</Text>
            <Text style={[s.th, s.wHsn]}>HSN/SAC</Text>
            <Text style={[s.th, s.wQty]}>Qty</Text>
            <Text style={[s.th, s.wRate]}>Rate</Text>
            <Text style={[s.th, s.wTaxable]}>Taxable Amt</Text>
            <Text style={[s.th, s.wTax]}>{isIGST ? "IGST" : "CGST+SGST"}</Text>
            <Text style={[s.th, s.wAmt]}>Credit Amt</Text>
          </View>

          {lineItems.map((item, idx) => (
            <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
              <Text style={[s.td, s.wNo]}>{idx + 1}</Text>
              <Text style={[s.td, s.wItem]}>
                {item.productName}{item.variantName ? `\n${item.variantName}` : ""}
              </Text>
              <Text style={[s.td, s.wHsn, { color: "#777" }]}>{item.hsnCode || "-"}</Text>
              <Text style={[s.td, s.wQty, { color: RED }]}>{Math.abs(item.quantity)}</Text>
              <Text style={[s.td, s.wRate]}>{formatRs(item.unitPrice)}</Text>
              <Text style={[s.td, s.wTaxable]}>{formatRs(item.taxableValue)}</Text>
              <Text style={[s.td, s.wTax, { color: "#555" }]}>
                {isIGST
                  ? `${item.igstRate}%\n${formatRs(item.igstAmount)}`
                  : `${item.cgstRate}%+${item.sgstRate}%\n${formatRs(item.cgstAmount + item.sgstAmount)}`}
              </Text>
              <Text style={[s.td, s.wAmt, { fontFamily: fonts.bold, color: RED }]}>
                {formatRs(item.totalAmount)}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsSection}>
          <View style={s.totalsBox}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Taxable Amount</Text>
              <Text style={s.totalValue}>{formatRs(totalTaxable)}</Text>
            </View>
            {isIGST ? (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>IGST</Text>
                <Text style={s.totalValue}>{formatRs(totalIgst)}</Text>
              </View>
            ) : (
              <>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>CGST</Text>
                  <Text style={s.totalValue}>{formatRs(totalCgst)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>SGST</Text>
                  <Text style={s.totalValue}>{formatRs(totalSgst)}</Text>
                </View>
              </>
            )}
            <View style={s.grandRow}>
              <Text style={s.grandLabel}>Total Credit Amount</Text>
              <Text style={s.grandVal}>{formatRs(totalCredit)}</Text>
            </View>
          </View>
        </View>

        {/* ── Amount in Words ── */}
        {invoice.amountInWords ? (
          <Text style={s.amtWords}>
            Credit: {invoice.amountInWords}
          </Text>
        ) : null}

        {/* ── Notice ── */}
        <View style={s.noticeBox}>
          <Text style={s.noticeTitle}>Important Notice</Text>
          <Text style={s.noticeText}>
            This credit note is issued against the above referenced order. The credit will be applied to your
            account or refunded as per the store policy. This document is computer generated and valid without
            signature.
          </Text>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>{shop.businessName || ""}</Text>
          <Text style={s.footerText}>Credit Note — {invoice.invoiceNumber}</Text>
          <Text style={s.footerText}>{formatDate(invoice.invoiceDate)}</Text>
        </View>

      </Page>
    </Document>
  );
}
