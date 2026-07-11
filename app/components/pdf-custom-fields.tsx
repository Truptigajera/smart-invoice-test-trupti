import { View, Text } from "@react-pdf/renderer";

type FieldDef = { key: string; label: string };

/**
 * Renders custom invoice fields (defined in ShopSettings.customFields, values in Invoice.customFieldValues).
 * Returns null if no fields are defined or no values are set.
 */
export function renderCustomFields(invoice: any, fontBase: string, fontBold: string) {
  if (!invoice?.customFieldValues && !invoice?.shop?.settings?.customFields) return null;

  let defs: FieldDef[] = [];
  let vals: Record<string, string> = {};
  try {
    defs = JSON.parse(invoice?.shop?.settings?.customFields || "[]");
    vals = JSON.parse(invoice?.customFieldValues || "{}");
  } catch {
    return null;
  }

  const entries = defs.filter((d: FieldDef) => vals[d.key]);
  if (entries.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        marginBottom: 8,
        borderTop: "0.5pt solid #e0e0e0",
        paddingTop: 6,
        gap: 4,
      }}
    >
      {entries.map((d: FieldDef) => (
        <View key={d.key} style={{ flexDirection: "row", width: "48%", marginBottom: 2 }}>
          <Text style={{ fontSize: 8, fontFamily: fontBold, color: "#555", width: 90 }}>
            {d.label}:
          </Text>
          <Text style={{ fontSize: 8, fontFamily: fontBase, color: "#222", flex: 1 }}>
            {vals[d.key]}
          </Text>
        </View>
      ))}
    </View>
  );
}
