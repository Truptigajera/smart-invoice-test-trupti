// Shared formatting for the invoice PDF templates, so every design prints the
// GST-mandatory fields the same way (Rule 46 of the CGST Rules).

import { STATE_CODES } from "~/lib/gst";

type PosSource = { placeOfSupply?: string | null; buyerState?: string | null; buyerStateCode?: string | null };

// Place of supply must name the state: "24-Gujarat" (was printed as just "24", or as the
// buyer's city, and two templates hard-coded "GJ" for every state)
export function placeOfSupplyText(inv: PosSource): string {
  const code = inv.placeOfSupply || inv.buyerStateCode || "";
  if (STATE_CODES[code]) return `${code}-${STATE_CODES[code]}`;
  return inv.buyerState || code || "-";
}

// Two-digit GST state code of the place of supply ("24"), or "-"
export function stateCodeText(inv: PosSource): string {
  const code = inv.placeOfSupply || inv.buyerStateCode || "";
  return STATE_CODES[code] ? code : "-";
}

// Every GST invoice must say whether tax is payable on reverse charge
export function reverseChargeText(inv: { reverseCharge?: boolean | null }): string {
  return inv.reverseCharge ? "Yes" : "No";
}
