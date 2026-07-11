// Orbix variant — dark navy, ultra minimal, thin borders, monochrome precision, matches template-6
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";

interface SlipLineItem { productName: string; variantName: string | null; quantity: number; unit: string; }
interface SlipShop { businessName: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; logoUrl: string | null; gstin: string | null; }
interface SlipInvoice { invoiceNumber: string; invoiceDate: string | Date; orderName: string | null; buyerName: string | null; buyerAddress: string | null; buyerCity: string | null; buyerState: string | null; buyerPincode: string | null; buyerPhone: string | null; buyerEmail: string | null; shop: SlipShop; lineItems: SlipLineItem[]; }

const C = "#0D2035";
const BORDER = "#B0BEC5";
const LIGHT = "#ECEFF1";

const makeStyles = (base: string, bold: string) => StyleSheet.create({
  page: { fontFamily: base, fontSize: 9, color: C, paddingTop: 32, paddingBottom: 40, paddingHorizontal: 32 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 14, borderBottom: `0.5pt solid ${BORDER}` },
  logo: { width: 70, height: 36, objectFit: "contain", marginBottom: 4 },
  companyName: { fontSize: 12, fontFamily: bold, color: C },
  companyDetail: { fontSize: 8, color: "#607D8B", marginTop: 1 },
  titleBlock: { alignItems: "flex-end" },
  labelText: { fontSize: 8, fontFamily: bold, color: "#607D8B", textTransform: "uppercase", letterSpacing: 1.5 },
  slipTitle: { fontSize: 22, fontFamily: bold, color: C },
  slipSub: { fontSize: 8, color: "#607D8B", marginTop: 2 },
  twoCol: { flexDirection: "row", gap: 14, marginBottom: 16 },
  colBox: { flex: 1, borderTop: `1.5pt solid ${C}`, paddingTop: 8 },
  colTitle: { fontSize: 7, fontFamily: bold, color: "#607D8B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  colName: { fontSize: 9, fontFamily: bold, color: C, marginBottom: 2 },
  colLine: { fontSize: 8, color: "#607D8B", marginBottom: 1 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14, gap: 6 },
  metaItem: { width: "48%", flexDirection: "row" },
  metaLabel: { width: 80, fontSize: 8, color: "#607D8B" },
  metaValue: { flex: 1, fontSize: 8, fontFamily: bold, color: C },
  sectionLabel: { fontSize: 7, fontFamily: bold, color: "#607D8B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  table: { marginBottom: 14 },
  tableHeader: { flexDirection: "row", borderBottom: `1pt solid ${C}`, paddingBottom: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", paddingVertical: 5, borderBottom: `0.5pt solid ${BORDER}` },
  tableRowAlt: { flexDirection: "row", paddingVertical: 5, borderBottom: `0.5pt solid ${BORDER}`, backgroundColor: LIGHT },
  th: { fontSize: 7, fontFamily: bold, color: "#607D8B", textTransform: "uppercase", letterSpacing: 0.5 },
  td: { fontSize: 8, color: C },
  colNo: { width: "6%" },
  colItem: { flex: 1 },
  colQty: { width: "14%", textAlign: "right" },
  colUnit: { width: "14%", textAlign: "right" },
  divider: { borderTop: `0.5pt solid ${BORDER}`, marginVertical: 10 },
  thankRow: { flexDirection: "row", justifyContent: "center", paddingTop: 8 },
  thankText: { fontSize: 9, fontFamily: bold, color: "#607D8B", letterSpacing: 0.5 },
  footer: { position: "absolute", bottom: 16, left: 32, right: 32, borderTop: `0.5pt solid ${BORDER}`, paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: BORDER },
});

function fmtDate(d: string | Date) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export function PackingSlipOrbixTemplate({ invoice, customization }: { invoice: SlipInvoice; customization?: TemplateCustomizationSettings }) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold);
  const { shop, lineItems } = invoice;
  const shopAddr = [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(", ");
  const buyerAddr = [invoice.buyerAddress, invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            {shop.logoUrl ? <Image src={shop.logoUrl} style={s.logo} /> : null}
            <Text style={s.companyName}>{shop.businessName || ""}</Text>
            {shopAddr ? <Text style={s.companyDetail}>{shopAddr}</Text> : null}
            {shop.phone ? <Text style={s.companyDetail}>Tel: {shop.phone}</Text> : null}
          </View>
          <View style={s.titleBlock}>
            <Text style={s.labelText}>Shipping Document</Text>
            <Text style={s.slipTitle}>PACKING SLIP</Text>
            <Text style={s.slipSub}>{invoice.orderName ? `Order: ${invoice.orderName}` : `Ref: ${invoice.invoiceNumber}`}</Text>
            <Text style={s.slipSub}>Date: {fmtDate(invoice.invoiceDate)}</Text>
          </View>
        </View>

        <View style={s.twoCol}>
          <View style={s.colBox}>
            <Text style={s.colTitle}>Shipped From</Text>
            <Text style={s.colName}>{shop.businessName || "Seller"}</Text>
            {shopAddr ? <Text style={s.colLine}>{shopAddr}</Text> : null}
            {shop.phone ? <Text style={s.colLine}>Tel: {shop.phone}</Text> : null}
            {shop.gstin ? <Text style={s.colLine}>GSTIN: {shop.gstin}</Text> : null}
          </View>
          <View style={s.colBox}>
            <Text style={s.colTitle}>Ship To</Text>
            <Text style={s.colName}>{invoice.buyerName || "Customer"}</Text>
            {buyerAddr ? <Text style={s.colLine}>{buyerAddr}</Text> : null}
            {invoice.buyerPhone ? <Text style={s.colLine}>Tel: {invoice.buyerPhone}</Text> : null}
            {invoice.buyerEmail ? <Text style={s.colLine}>{invoice.buyerEmail}</Text> : null}
          </View>
        </View>

        <View style={s.metaGrid}>
          <View style={s.metaItem}><Text style={s.metaLabel}>Invoice Ref</Text><Text style={s.metaValue}>{invoice.invoiceNumber}</Text></View>
          {invoice.orderName ? <View style={s.metaItem}><Text style={s.metaLabel}>Order #</Text><Text style={s.metaValue}>{invoice.orderName}</Text></View> : null}
          <View style={s.metaItem}><Text style={s.metaLabel}>Date</Text><Text style={s.metaValue}>{fmtDate(invoice.invoiceDate)}</Text></View>
          <View style={s.metaItem}><Text style={s.metaLabel}>Total Items</Text><Text style={s.metaValue}>{lineItems.length}</Text></View>
        </View>

        <Text style={s.sectionLabel}>Items</Text>
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.th, s.colNo]}>#</Text>
            <Text style={[s.th, s.colItem]}>Product</Text>
            <Text style={[s.th, s.colQty]}>Qty</Text>
            <Text style={[s.th, s.colUnit]}>Unit</Text>
          </View>
          {lineItems.map((item, idx) => (
            <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
              <Text style={[s.td, s.colNo]}>{idx + 1}</Text>
              <View style={s.colItem}>
                <Text style={[s.td, { fontFamily: fonts.bold }]}>{item.productName}</Text>
                {item.variantName && <Text style={{ fontSize: 7.5, color: "#90A4AE" }}>{item.variantName}</Text>}
              </View>
              <Text style={[s.td, s.colQty]}>{item.quantity}</Text>
              <Text style={[s.td, s.colUnit]}>{item.unit || "NOS"}</Text>
            </View>
          ))}
        </View>

        <View style={s.divider} />
        <View style={s.thankRow}>
          <Text style={s.thankText}>Thank you for your order</Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>This is a packing slip — not a tax invoice.</Text>
          <Text style={s.footerText}>Generated by GST Invoice Pro</Text>
        </View>
      </Page>
    </Document>
  );
}
