import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";

interface SlipLineItem {
  productName: string;
  variantName: string | null;
  quantity: number;
  unit: string;
}

interface SlipShop {
  businessName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  gstin: string | null;
}

interface SlipInvoice {
  invoiceNumber: string;
  invoiceDate: string | Date;
  orderName: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerCity: string | null;
  buyerState: string | null;
  buyerPincode: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  shop: SlipShop;
  lineItems: SlipLineItem[];
}

interface Props {
  invoice: SlipInvoice;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
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
    borderBottom: "2pt solid #333",
    paddingBottom: 10,
  },
  logo: { width: 60, height: 40, objectFit: "contain" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#222" },
  subtitle: { fontSize: 9, color: "#666", marginTop: 2 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#666", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.5 },
  twoCol: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
  addressBox: {
    borderRadius: 4,
    border: "1pt solid #e0e0e0",
    padding: 8,
    backgroundColor: "#fafafa",
  },
  addressName: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 2 },
  addressLine: { fontSize: 9, color: "#444", lineHeight: 1.4 },
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#333",
    color: "#fff",
    padding: "5 8",
    borderRadius: "3 3 0 0",
  },
  tableRow: {
    flexDirection: "row",
    padding: "5 8",
    borderBottom: "1pt solid #eee",
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: "5 8",
    borderBottom: "1pt solid #eee",
    backgroundColor: "#f9f9f9",
  },
  colNo: { width: "8%", fontFamily: "Helvetica-Bold" },
  colItem: { flex: 1 },
  colQty: { width: "15%", textAlign: "right" },
  colUnit: { width: "15%", textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    borderTop: "1pt solid #e0e0e0",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 8, color: "#888" },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 90, fontFamily: "Helvetica-Bold", color: "#555", fontSize: 8 },
  metaValue: { flex: 1, fontSize: 8 },
  thankYou: {
    marginTop: 16,
    padding: 10,
    backgroundColor: "#f0f4ff",
    borderRadius: 4,
    textAlign: "center",
  },
  thankYouText: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#1a73e8" },
});

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function PackingSlipPDFTemplate({ invoice }: Props) {
  const { shop, lineItems } = invoice;
  const shopAddress = [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(", ");
  const buyerAddress = [invoice.buyerAddress, invoice.buyerCity, invoice.buyerState, invoice.buyerPincode].filter(Boolean).join(", ");

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            {shop.logoUrl ? (
              <Image src={shop.logoUrl} style={styles.logo} />
            ) : (
              <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: "#333" }}>
                {shop.businessName || ""}
              </Text>
            )}
            {shopAddress ? (
              <Text style={{ fontSize: 8, color: "#666", marginTop: 3, maxWidth: 200 }}>{shopAddress}</Text>
            ) : null}
            {shop.phone ? <Text style={{ fontSize: 8, color: "#666" }}>Tel: {shop.phone}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>PACKING SLIP</Text>
            <Text style={styles.subtitle}>
              {invoice.orderName ? `Order: ${invoice.orderName}` : `Ref: ${invoice.invoiceNumber}`}
            </Text>
            <Text style={styles.subtitle}>Date: {fmtDate(invoice.invoiceDate)}</Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={[styles.twoCol, styles.section]}>
          {/* From */}
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Shipped From</Text>
            <View style={styles.addressBox}>
              <Text style={styles.addressName}>{shop.businessName || "Seller"}</Text>
              {shopAddress ? <Text style={styles.addressLine}>{shopAddress}</Text> : null}
              {shop.phone ? <Text style={styles.addressLine}>Tel: {shop.phone}</Text> : null}
              {shop.gstin ? <Text style={styles.addressLine}>GSTIN: {shop.gstin}</Text> : null}
            </View>
          </View>
          {/* To */}
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Ship To</Text>
            <View style={styles.addressBox}>
              <Text style={styles.addressName}>{invoice.buyerName || "Customer"}</Text>
              {buyerAddress ? <Text style={styles.addressLine}>{buyerAddress}</Text> : null}
              {invoice.buyerPhone ? <Text style={styles.addressLine}>Tel: {invoice.buyerPhone}</Text> : null}
              {invoice.buyerEmail ? <Text style={styles.addressLine}>{invoice.buyerEmail}</Text> : null}
            </View>
          </View>
        </View>

        {/* Order meta */}
        <View style={[styles.section, { marginBottom: 8 }]}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Invoice Ref:</Text>
            <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
          </View>
          {invoice.orderName ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Order #:</Text>
              <Text style={styles.metaValue}>{invoice.orderName}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date:</Text>
            <Text style={styles.metaValue}>{fmtDate(invoice.invoiceDate)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Total Items:</Text>
            <Text style={styles.metaValue}>{lineItems.length}</Text>
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colNo}>#</Text>
              <Text style={[styles.colItem, { color: "#fff", fontFamily: "Helvetica-Bold" }]}>Product</Text>
              <Text style={[styles.colQty, { color: "#fff", fontFamily: "Helvetica-Bold" }]}>Qty</Text>
              <Text style={[styles.colUnit, { color: "#fff", fontFamily: "Helvetica-Bold" }]}>Unit</Text>
            </View>
            {lineItems.map((item, idx) => (
              <View key={idx} style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                <Text style={styles.colNo}>{idx + 1}</Text>
                <View style={styles.colItem}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{item.productName}</Text>
                  {item.variantName && (
                    <Text style={{ color: "#666", fontSize: 8 }}>{item.variantName}</Text>
                  )}
                </View>
                <Text style={styles.colQty}>{item.quantity}</Text>
                <Text style={styles.colUnit}>{item.unit || "NOS"}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Thank you */}
        <View style={styles.thankYou}>
          <Text style={styles.thankYouText}>Thank you for your order!</Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>This is a packing slip — not a tax invoice.</Text>
        </View>
      </Page>
    </Document>
  );
}
