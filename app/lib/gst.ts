// GST state codes (first 2 digits of GSTIN)
export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh (New)",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

// Standard GST rates in India
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

export interface TaxBreakdown {
  taxType: "IGST" | "CGST_SGST";
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  totalAmount: number;
}

// Determine IGST or CGST+SGST based on seller and buyer state
export function determineTaxType(
  sellerStateCode: string,
  buyerStateCode: string
): "IGST" | "CGST_SGST" {
  if (!buyerStateCode || sellerStateCode === buyerStateCode) {
    return "CGST_SGST"; // same state = intra-state
  }
  return "IGST"; // different state = inter-state
}

// Calculate GST breakdown for a line item
export function calculateLineTax(
  taxableAmount: number,
  gstRate: number, // e.g. 18 for 18%
  taxType: "IGST" | "CGST_SGST"
): Pick<TaxBreakdown, "cgstRate" | "sgstRate" | "igstRate" | "cgstAmount" | "sgstAmount" | "igstAmount"> {
  if (taxType === "IGST") {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: gstRate,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: round2(taxableAmount * gstRate / 100),
    };
  } else {
    const halfRate = gstRate / 2;
    return {
      cgstRate: halfRate,
      sgstRate: halfRate,
      igstRate: 0,
      cgstAmount: round2(taxableAmount * halfRate / 100),
      sgstAmount: round2(taxableAmount * halfRate / 100),
      igstAmount: 0,
    };
  }
}

// Split an already-known GST amount into CGST/SGST or IGST. Works in paise so the two
// halves always add back up to the exact amount (₹30.51 → 15.25 + 15.26).
export function splitGst(
  taxAmount: number,
  gstRate: number,
  taxType: "IGST" | "CGST_SGST"
): Pick<TaxBreakdown, "cgstRate" | "sgstRate" | "igstRate" | "cgstAmount" | "sgstAmount" | "igstAmount"> {
  const paise = Math.round(taxAmount * 100);
  if (taxType === "IGST") {
    return { cgstRate: 0, sgstRate: 0, igstRate: gstRate, cgstAmount: 0, sgstAmount: 0, igstAmount: paise / 100 };
  }
  const half = Math.floor(paise / 2);
  return {
    cgstRate: gstRate / 2,
    sgstRate: gstRate / 2,
    igstRate: 0,
    cgstAmount: half / 100,
    sgstAmount: (paise - half) / 100,
    igstAmount: 0,
  };
}

// Extract state code from GSTIN (first 2 characters)
export function getStateCodeFromGstin(gstin: string): string {
  return gstin?.substring(0, 2) || "";
}

// Map Shopify province names/codes to Indian state codes
export function getIndianStateCode(provinceCode: string, provinceName: string): string {
  const codeMap: Record<string, string> = {
    AP: "28", AR: "12", AS: "18", BR: "10", CG: "22", GA: "30",
    GJ: "24", HR: "06", HP: "02", JH: "20", KA: "29", KL: "32",
    MP: "23", MH: "27", MN: "14", ML: "17", MZ: "15", NL: "13",
    OD: "21", PB: "03", RJ: "08", SK: "11", TN: "33", TS: "36",
    TR: "16", UP: "09", UK: "05", WB: "19",
    CH: "04", DL: "07", JK: "01", LA: "38", PY: "34",
  };

  // Try province code first (Shopify uses 2-letter codes)
  const upperCode = provinceCode.toUpperCase().replace("IN-", "");
  if (codeMap[upperCode]) return codeMap[upperCode];

  // Fallback: try to match by name
  const nameMap: Record<string, string> = {
    "maharashtra": "27", "gujarat": "24", "delhi": "07",
    "karnataka": "29", "tamil nadu": "33", "rajasthan": "08",
    "uttar pradesh": "09", "west bengal": "19", "telangana": "36",
  };
  return nameMap[provinceName.toLowerCase()] || "";
}

// Validate GSTIN format
export function validateGstin(gstin: string): boolean {
  const g = gstin?.toUpperCase() || "";
  const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinPattern.test(g) && g[14] === gstinCheckChar(g);
}

// The 15th GSTIN character is a checksum of the first 14 (GSTN's base-36 Luhn variant).
// Catches typos and made-up numbers like the "22AAAAA0000A1Z5" example placeholder.
function gstinCheckChar(g: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return chars[(36 - (sum % 36)) % 36];
}

// Get state name from state code
export function getStateName(stateCode: string): string {
  return STATE_CODES[stateCode] || "";
}

// Convert amount to Indian words
export function amountToWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty",
    "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertHundreds(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
    return ones[Math.floor(n / 100)] + " Hundred " + convertHundreds(n % 100);
  }

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  let result = "";
  if (rupees > 0) {
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const remainder = rupees % 1000;

    if (crore) result += convertHundreds(crore) + "Crore ";
    if (lakh) result += convertHundreds(lakh) + "Lakh ";
    if (thousand) result += convertHundreds(thousand) + "Thousand ";
    if (remainder) result += convertHundreds(remainder);

    result += "Rupees";
  }

  if (paise > 0) {
    result += " and " + convertHundreds(paise) + "Paise";
  }

  return result.trim() + " Only";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
