// Estimate / Quotation PDF — amber/gold accent, clearly distinguished from tax invoices
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EstimateLineItem {
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: number;
  discountedUnitPrice: number;
  taxRate: number;        // e.g. 18 for 18%
  taxAmount: number;
  totalAmount: number;
  hsnCode: string | null; // from the product's gst_invoice.hsn_code metafield
}

export interface EstimateShop {
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

export interface EstimateData {
  estimateNumber: string;   // draft order name e.g. #D1
  estimateDate: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPincode: string | null;
  lineItems: EstimateLineItem[];
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  total: number;
  note: string | null;
  shop: EstimateShop;
  // Same-state buyer → CGST + SGST (half each); other state → IGST
  taxType: "IGST" | "CGST_SGST";
  // true when prices already include GST (subtotal/total contain the tax)
  taxesIncluded: boolean;
  placeOfSupply: string | null; // buyer's state, e.g. "Gujarat (24)"
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GOLD = "#E65100";
const GOLD_LIGHT = "#FFF3E0";
const GOLD_MID = "#FFE0B2";
const DARK = "#1A1A1A";

const makeStyles = (base: string, bold: string, boldItalic: string) =>
  StyleSheet.create({
    page: {
      fontFamily: base,
      fontSize: 9,
      color: DARK,
      paddingTop: 30,
      paddingBottom: 44,
      paddingHorizontal: 32,
    },
    // ── Header ──────────────────────────────────────────────────────
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 18,
      paddingBottom: 12,
      borderBottom: `2pt solid ${GOLD}`,
    },
    logo: { width: 80, height: 40, objectFit: "contain", marginBottom: 4 },
    companyName: { fontSize: 13, fontFamily: bold, color: DARK },
    companyDetail: { fontSize: 8, color: "#666", marginTop: 1 },
    titleBlock: { alignItems: "flex-end" },
    quoteLabel: { fontSize: 8, fontFamily: bold, color: GOLD, textTransform: "uppercase", letterSpacing: 1.5 },
    quoteTitle: { fontSize: 22, fontFamily: bold, color: GOLD },
    quoteNumber: { fontSize: 9, color: "#444", marginTop: 3 },
    quoteDate: { fontSize: 8, color: "#777", marginTop: 2 },
    // ── Validity badge ───────────────────────────────────────────────
    validityBadge: {
      alignSelf: "flex-end",
      marginTop: 4,
      backgroundColor: GOLD,
      color: "#fff",
      fontSize: 7,
      fontFamily: bold,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 3,
    },
    // ── Info boxes ───────────────────────────────────────────────────
    infoRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    infoBox: { flex: 1, border: `1pt solid #e0d4b0`, borderRadius: 3, padding: 8, backgroundColor: GOLD_LIGHT },
    infoBoxGold: { flex: 1, border: `1pt solid ${GOLD}`, borderRadius: 3, padding: 8, backgroundColor: GOLD_MID },
    infoTitle: {
      fontSize: 7, fontFamily: bold, color: GOLD,
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
    },
    infoName: { fontSize: 8.5, fontFamily: bold, marginBottom: 2 },
    infoDetail: { fontSize: 8, color: "#555", marginBottom: 1 },
    infoRow2: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
    infoLabel: { fontSize: 8, color: "#666" },
    infoValue: { fontSize: 8, fontFamily: bold, color: DARK },
    // ── Table ────────────────────────────────────────────────────────
    table: { marginBottom: 12 },
    tableHeader: { flexDirection: "row", backgroundColor: GOLD, padding: "4 5" },
    tableRow: { flexDirection: "row", padding: "4 5", borderBottom: "0.5pt solid #f0e8d8" },
    tableRowAlt: { flexDirection: "row", padding: "4 5", backgroundColor: GOLD_LIGHT, borderBottom: "0.5pt solid #f0e8d8" },
    th: { color: "#fff", fontSize: 7, fontFamily: bold },
    td: { fontSize: 8 },
    wNo: { width: "4%" },
    wItem: { width: "32%" },
    wQty: { width: "7%", textAlign: "right" },
    wRate: { width: "12%", textAlign: "right" },
    wDiscount: { width: "10%", textAlign: "right" },
    wTax: { width: "12%", textAlign: "right" },
    wTotal: { width: "13%", textAlign: "right" },
    // ── Totals ───────────────────────────────────────────────────────
    totalsSection: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
    totalsBox: { width: 240 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", padding: "3 4" },
    totalRowBorder: { flexDirection: "row", justifyContent: "space-between", padding: "3 4", borderTop: "0.5pt solid #e0d4b0" },
    totalLabel: { fontSize: 8, color: "#666" },
    totalValue: { fontSize: 8 },
    grandRow: {
      flexDirection: "row", justifyContent: "space-between",
      backgroundColor: GOLD, padding: "5 4", borderRadius: 2, marginTop: 2,
    },
    grandLabel: { fontSize: 9, fontFamily: bold, color: "#fff" },
    grandVal: { fontSize: 9, fontFamily: bold, color: "#fff" },
    // ── Note ─────────────────────────────────────────────────────────
    noteBox: {
      backgroundColor: GOLD_LIGHT, border: `0.5pt solid #e0c88a`,
      borderRadius: 3, padding: 8, marginBottom: 10,
    },
    noteTitle: { fontSize: 7.5, fontFamily: bold, color: GOLD, marginBottom: 2 },
    noteText: { fontSize: 8, color: "#555" },
    // ── Disclaimer ───────────────────────────────────────────────────
    disclaimer: {
      backgroundColor: "#FFFDE7", border: `0.5pt solid #FDD835`,
      borderRadius: 3, padding: 7, marginBottom: 8,
    },
    disclaimerText: {
      fontSize: 7.5, fontFamily: boldItalic, color: "#795548",
      textAlign: "center",
    },
    // ── Footer ───────────────────────────────────────────────────────
    footer: {
      position: "absolute",
      bottom: 18, left: 32, right: 32,
      borderTop: "0.5pt solid #e0d4b0",
      paddingTop: 6,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    footerText: { fontSize: 7, color: "#aaa" },
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRs(n: number): string {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EstimatePDFTemplate({
  estimate,
  customization,
}: {
  estimate: EstimateData;
  customization?: TemplateCustomizationSettings;
}) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold, fonts.boldItalic);

  const { shop, lineItems } = estimate;

  // Totals in paise so the CGST + SGST halves always add up to the exact GST
  // (₹30.51 → 15.25 + 15.26, not 15.26 + 15.26)
  const taxPaise = Math.round(estimate.totalTax * 100);
  const cgst = Math.floor(taxPaise / 2) / 100;
  const sgst = (taxPaise - Math.floor(taxPaise / 2)) / 100;
  const taxableValue = (Math.round(estimate.total * 100) - taxPaise) / 100;
  const showLogo = cx.overview.showLogo && !!shop.logoUrl;
  const showGstin = cx.overview.showSupplierGstin && !!shop.gstin;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            {showLogo ? <Image src={shop.logoUrl!} style={s.logo} /> : null}
            <Text style={s.companyName}>{shop.businessName || "Business Name"}</Text>
            {showGstin ? <Text style={s.companyDetail}>GSTIN: {shop.gstin}</Text> : null}
            {shop.address ? <Text style={s.companyDetail}>{shop.address}</Text> : null}
            {(shop.city || shop.state) ? (
              <Text style={s.companyDetail}>
                {[shop.city, shop.state, shop.pincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {shop.phone ? <Text style={s.companyDetail}>Ph: {shop.phone}</Text> : null}
          </View>
          <View style={s.titleBlock}>
            <Text style={s.quoteLabel}>Estimate / Quotation</Text>
            <Text style={s.quoteTitle}>QUOTATION</Text>
            <Text style={s.quoteNumber}>No. {estimate.estimateNumber}</Text>
            <Text style={s.quoteDate}>Date: {formatDate(estimate.estimateDate)}</Text>
            <Text style={s.validityBadge}>Subject to GST at time of invoicing</Text>
          </View>
        </View>

        {/* ── Customer + Quote Details ── */}
        <View style={s.infoRow}>
          <View style={s.infoBox}>
            <Text style={s.infoTitle}>Quote To</Text>
            {estimate.customerName ? <Text style={s.infoName}>{estimate.customerName}</Text> : null}
            {estimate.billingAddress ? <Text style={s.infoDetail}>{estimate.billingAddress}</Text> : null}
            {(estimate.billingCity || estimate.billingState) ? (
              <Text style={s.infoDetail}>
                {[estimate.billingCity, estimate.billingState, estimate.billingPincode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
            {estimate.customerEmail ? <Text style={s.infoDetail}>{estimate.customerEmail}</Text> : null}
            {estimate.customerPhone ? <Text style={s.infoDetail}>Ph: {estimate.customerPhone}</Text> : null}
          </View>

          <View style={s.infoBoxGold}>
            <Text style={s.infoTitle}>Quotation Details</Text>
            <View style={s.infoRow2}>
              <Text style={s.infoLabel}>Quote No.</Text>
              <Text style={s.infoValue}>{estimate.estimateNumber}</Text>
            </View>
            <View style={s.infoRow2}>
              <Text style={s.infoLabel}>Date</Text>
              <Text style={s.infoValue}>{formatDate(estimate.estimateDate)}</Text>
            </View>
            {shop.gstin ? (
              <View style={s.infoRow2}>
                <Text style={s.infoLabel}>Seller GSTIN</Text>
                <Text style={s.infoValue}>{shop.gstin}</Text>
              </View>
            ) : null}
            {estimate.placeOfSupply ? (
              <View style={s.infoRow2}>
                <Text style={s.infoLabel}>Place of Supply</Text>
                <Text style={s.infoValue}>{estimate.placeOfSupply}</Text>
              </View>
            ) : null}
            <View style={s.infoRow2}>
              <Text style={s.infoLabel}>Items</Text>
              <Text style={s.infoValue}>{lineItems.length}</Text>
            </View>
          </View>
        </View>

        {/* ── Line Items ── */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.th, s.wNo]}>#</Text>
            <Text style={[s.th, s.wItem]}>Item Description</Text>
            <Text style={[s.th, s.wQty]}>Qty</Text>
            <Text style={[s.th, s.wRate]}>Rate</Text>
            <Text style={[s.th, s.wDiscount]}>Discount</Text>
            <Text style={[s.th, s.wTax]}>Est. GST</Text>
            <Text style={[s.th, s.wTotal]}>Amount</Text>
          </View>
          {lineItems.map((item, idx) => {
            const discountAmt = (item.unitPrice - item.discountedUnitPrice) * item.quantity;
            return (
              <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={[s.td, s.wNo]}>{idx + 1}</Text>
                <Text style={[s.td, s.wItem]}>
                  {item.title}{item.variantTitle ? `\n${item.variantTitle}` : ""}
                  {item.hsnCode ? `\nHSN: ${item.hsnCode}` : ""}
                </Text>
                <Text style={[s.td, s.wQty]}>{item.quantity}</Text>
                <Text style={[s.td, s.wRate]}>{formatRs(item.discountedUnitPrice)}</Text>
                <Text style={[s.td, s.wDiscount, { color: "#888" }]}>
                  {discountAmt > 0 ? `- ${formatRs(discountAmt)}` : "—"}
                </Text>
                <Text style={[s.td, s.wTax, { color: "#888" }]}>
                  {item.taxRate > 0 ? `${item.taxRate}%\n${formatRs(item.taxAmount)}` : "—"}
                </Text>
                <Text style={[s.td, s.wTotal, { fontFamily: fonts.bold }]}>
                  {formatRs(item.totalAmount)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsSection}>
          <View style={s.totalsBox}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal{estimate.taxesIncluded && estimate.totalTax > 0 ? " (incl. GST)" : ""}</Text>
              <Text style={s.totalValue}>{formatRs(estimate.subtotal)}</Text>
            </View>
            {estimate.totalDiscount > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Discount</Text>
                <Text style={s.totalValue}>- {formatRs(estimate.totalDiscount)}</Text>
              </View>
            )}
            {/* GST is charged on the taxable value; works whether prices include GST or not */}
            {estimate.totalTax > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Taxable Value</Text>
                <Text style={s.totalValue}>{formatRs(taxableValue)}</Text>
              </View>
            )}
            {estimate.totalTax > 0 && estimate.taxType === "CGST_SGST" && (
              <>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Est. CGST</Text>
                  <Text style={s.totalValue}>{formatRs(cgst)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Est. SGST</Text>
                  <Text style={s.totalValue}>{formatRs(sgst)}</Text>
                </View>
              </>
            )}
            {estimate.totalTax > 0 && estimate.taxType === "IGST" && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Est. IGST</Text>
                <Text style={s.totalValue}>{formatRs(estimate.totalTax)}</Text>
              </View>
            )}
            <View style={s.grandRow}>
              <Text style={s.grandLabel}>Total Estimate</Text>
              <Text style={s.grandVal}>{formatRs(estimate.total)}</Text>
            </View>
          </View>
        </View>

        {/* ── Order Note ── */}
        {estimate.note ? (
          <View style={s.noteBox}>
            <Text style={s.noteTitle}>Note</Text>
            <Text style={s.noteText}>{estimate.note}</Text>
          </View>
        ) : null}

        {/* ── Disclaimer ── */}
        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>
            This is an estimate / quotation only — not a tax invoice. GST will be calculated and a proper
            GST Tax Invoice will be issued upon confirmation and payment.
          </Text>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>{shop.businessName || ""}</Text>
          <Text style={s.footerText}>Estimate {estimate.estimateNumber}</Text>
          <Text style={s.footerText}>{formatDate(estimate.estimateDate)}</Text>
        </View>

      </Page>
    </Document>
  );
}
