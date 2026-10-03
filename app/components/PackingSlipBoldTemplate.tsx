// Bold variant — dark charcoal header, strong typography, matches template-2 style
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateCustomizationSettings } from "~/lib/customization.types";
import { DEFAULT_CUSTOMIZATION } from "~/lib/customization.types";
import { getPdfFonts } from "~/lib/pdf-font-utils";

interface SlipLineItem { productName: string; variantName: string | null; quantity: number; unit: string; }
interface SlipShop { businessName: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; logoUrl: string | null; gstin: string | null; }
interface SlipInvoice { invoiceNumber: string; invoiceDate: string | Date; orderName: string | null; buyerName: string | null; buyerAddress: string | null; buyerCity: string | null; buyerState: string | null; buyerPincode: string | null; buyerPhone: string | null; buyerEmail: string | null; shop: SlipShop; lineItems: SlipLineItem[]; }

const C = "#1C1C1E";
const LIGHT = "#F5F5F5";

const makeStyles = (base: string, bold: string) => StyleSheet.create({
  page: { fontFamily: base, fontSize: 9, color: C, paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0 },
  headerBand: { backgroundColor: C, paddingVertical: 18, paddingHorizontal: 30, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  logo: { width: 70, height: 36, objectFit: "contain" },
  companyName: { fontSize: 14, fontFamily: bold, color: "#fff" },
  companyDetail: { fontSize: 8, color: "#aaa", marginTop: 1 },
  titleBlock: { alignItems: "flex-end" },
  slipTitle: { fontSize: 20, fontFamily: bold, color: "#fff" },
  slipSub: { fontSize: 8, color: "#bbb", marginTop: 2 },
  body: { paddingHorizontal: 30 },
  twoCol: { flexDirection: "row", gap: 14, marginBottom: 14 },
  colBox: { flex: 1, border: `1pt solid #e0e0e0`, borderRadius: 3, padding: 8 },
  colBoxDark: { flex: 1, backgroundColor: LIGHT, borderRadius: 3, padding: 8 },
  colTitle: { fontSize: 7, fontFamily: bold, color: C, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, borderBottom: `1pt solid ${C}`, paddingBottom: 3 },
  colName: { fontSize: 9, fontFamily: bold, marginBottom: 2 },
  colLine: { fontSize: 8, color: "#555", marginBottom: 1 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 90, fontFamily: bold, color: "#444", fontSize: 8 },
  metaValue: { flex: 1, fontSize: 8 },
  sectionTitle: { fontSize: 8, fontFamily: bold, color: C, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  table: { marginBottom: 14 },
  tableHeader: { flexDirection: "row", backgroundColor: C, padding: "4 6", borderRadius: "2 2 0 0" },
  tableRow: { flexDirection: "row", padding: "5 6", borderBottom: "0.5pt solid #eee" },
  tableRowAlt: { flexDirection: "row", padding: "5 6", borderBottom: "0.5pt solid #eee", backgroundColor: LIGHT },
  th: { color: "#fff", fontSize: 7, fontFamily: bold },
  td: { fontSize: 8, color: C },
  colNo: { width: "6%" },
  colItem: { flex: 1 },
  colQty: { width: "14%", textAlign: "right" },
  colUnit: { width: "14%", textAlign: "right" },
  thankBox: { backgroundColor: C, borderRadius: 3, padding: 10, marginTop: 4, alignItems: "center" },
  thankText: { fontSize: 10, fontFamily: bold, color: "#fff" },
  footer: { position: "absolute", bottom: 16, left: 30, right: 30, borderTop: "0.5pt solid #ccc", paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: "#888" },
});

function fmtDate(d: string | Date) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export function PackingSlipBoldTemplate({ invoice, customization }: { invoice: SlipInvoice; customization?: TemplateCustomizationSettings }) {
  const cx = customization ?? DEFAULT_CUSTOMIZATION;
  const fonts = getPdfFonts(cx.branding.fontFamily);
  const s = makeStyles(fonts.base, fonts.bold);
  const { shop, lineItems } = invoice;
  const shopAddr = [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(", ");
  const buyerAddr = [invoice.buyerAddress, invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerBand}>
          <View>
            {shop.logoUrl ? <Image src={shop.logoUrl} style={s.logo} /> : <Text style={s.companyName}>{shop.businessName || ""}</Text>}
            {shop.logoUrl && <Text style={s.companyName}>{shop.businessName || ""}</Text>}
            {shopAddr ? <Text style={s.companyDetail}>{shopAddr}</Text> : null}
            {shop.phone ? <Text style={s.companyDetail}>Tel: {shop.phone}</Text> : null}
          </View>
          <View style={s.titleBlock}>
            <Text style={s.slipTitle}>PACKING SLIP</Text>
            <Text style={s.slipSub}>{invoice.orderName ? `Order: ${invoice.orderName}` : `Ref: ${invoice.invoiceNumber}`}</Text>
            <Text style={s.slipSub}>Date: {fmtDate(invoice.invoiceDate)}</Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.twoCol}>
            <View style={s.colBox}>
              <Text style={s.colTitle}>Shipped From</Text>
              <Text style={s.colName}>{shop.businessName || "Seller"}</Text>
              {shopAddr ? <Text style={s.colLine}>{shopAddr}</Text> : null}
              {shop.phone ? <Text style={s.colLine}>Tel: {shop.phone}</Text> : null}
              {shop.gstin ? <Text style={s.colLine}>GSTIN: {shop.gstin}</Text> : null}
            </View>
            <View style={s.colBoxDark}>
              <Text style={s.colTitle}>Ship To</Text>
              <Text style={s.colName}>{invoice.buyerName || "Customer"}</Text>
              {buyerAddr ? <Text style={s.colLine}>{buyerAddr}</Text> : null}
              {invoice.buyerPhone ? <Text style={s.colLine}>Tel: {invoice.buyerPhone}</Text> : null}
              {invoice.buyerEmail ? <Text style={s.colLine}>{invoice.buyerEmail}</Text> : null}
            </View>
          </View>

          <View style={{ marginBottom: 10 }}>
            <View style={s.metaRow}><Text style={s.metaLabel}>Invoice Ref:</Text><Text style={s.metaValue}>{invoice.invoiceNumber}</Text></View>
            {invoice.orderName ? <View style={s.metaRow}><Text style={s.metaLabel}>Order #:</Text><Text style={s.metaValue}>{invoice.orderName}</Text></View> : null}
            <View style={s.metaRow}><Text style={s.metaLabel}>Date:</Text><Text style={s.metaValue}>{fmtDate(invoice.invoiceDate)}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Total Items:</Text><Text style={s.metaValue}>{lineItems.length}</Text></View>
          </View>

          <Text style={s.sectionTitle}>Items</Text>
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
                  {item.variantName && <Text style={{ fontSize: 7.5, color: "#777" }}>{item.variantName}</Text>}
                </View>
                <Text style={[s.td, s.colQty]}>{item.quantity}</Text>
                <Text style={[s.td, s.colUnit]}>{item.unit || "NOS"}</Text>
              </View>
            ))}
          </View>

          <View style={s.thankBox}>
            <Text style={s.thankText}>Thank you for your order!</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>This is a packing slip — not a tax invoice.</Text>
        </View>
      </Page>
    </Document>
  );
}
