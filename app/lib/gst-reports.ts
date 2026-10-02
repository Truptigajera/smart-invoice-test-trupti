// GST return data (GSTR-1 / GSTR-3B) built from saved invoices.
// Pure functions — no DB or Shopify calls — so the numbers can be unit-tested.
//
// Layouts follow the GST portal's Offline Tool CSV templates, so the files can be imported
// as-is: B2B, B2CL, B2CS, HSN (B2B / B2C) and Documents issued.

import { STATE_CODES, validateGstin } from "~/lib/gst";

// B2C invoices to another state above this value are reported invoice-wise (B2CL).
// Lowered from ₹2.5 lakh to ₹1 lakh from August 2024.
export const B2CL_THRESHOLD = 100000;

export type ReportLineItem = {
  productName: string;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  taxableValue: number;
  cgstRate: number; sgstRate: number; igstRate: number;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
};

export type ReportInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | Date;
  buyerName: string | null;
  buyerGstin: string | null;
  placeOfSupply: string | null;
  taxType: string;
  taxableAmount: number;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
  shippingAmount: number;
  shippingTax: number;
  totalAmount: number;
  lineItems: ReportLineItem[];
};

export type Seller = { gstin: string; stateCode: string; shippingSac: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

// "24" → "24-Gujarat" (the portal's Place of Supply format)
export const posLabel = (code: string) => (STATE_CODES[code] ? `${code}-${STATE_CODES[code]}` : code);

// 01-Oct-26 — the date format the Offline Tool expects (always 3-letter months: Intl gives "Sept")
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function portalDate(d: string | Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "numeric", year: "2-digit" })
    .formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${MONTHS[Number(get("month")) - 1]}-${get("year")}`;
}

// Tax split for an amount at a rate, matching how the invoice itself was split
function splitTax(tax: number, interState: boolean) {
  if (interState) return { igst: r2(tax), cgst: 0, sgst: 0 };
  const half = Math.floor(Math.round(tax * 100) / 2) / 100;
  return { igst: 0, cgst: half, sgst: r2(tax - half) };
}

type RateBucket = { rate: number; taxable: number; igst: number; cgst: number; sgst: number };

// One invoice → its taxable value and tax per GST rate. Shipping is a taxable supply too:
// it's added at the rate it was taxed at (it was silently left out of every report before).
export function rateBuckets(inv: ReportInvoice): RateBucket[] {
  const buckets = new Map<number, RateBucket>();
  const add = (rate: number, taxable: number, igst: number, cgst: number, sgst: number) => {
    const b = buckets.get(rate) ?? { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    b.taxable += taxable; b.igst += igst; b.cgst += cgst; b.sgst += sgst;
    buckets.set(rate, b);
  };
  for (const li of inv.lineItems) {
    add(lineRate(li), li.taxableValue, li.igstAmount, li.cgstAmount, li.sgstAmount);
  }
  if (inv.shippingAmount > 0) {
    const rate = shippingRate(inv);
    const t = splitTax(inv.shippingTax, inv.taxType === "IGST");
    add(rate, inv.shippingAmount, t.igst, t.cgst, t.sgst);
  }
  return Array.from(buckets.values()).map((b) => ({
    rate: b.rate, taxable: r2(b.taxable), igst: r2(b.igst), cgst: r2(b.cgst), sgst: r2(b.sgst),
  }));
}

export const lineRate = (li: ReportLineItem) => r2(li.igstRate || li.cgstRate + li.sgstRate);

// Shipping's own rate isn't stored, so derive it and snap to the nearest real slab
const SLABS = [0, 0.25, 1.5, 3, 5, 12, 18, 28, 40];
function shippingRate(inv: ReportInvoice) {
  if (!inv.shippingTax || !inv.shippingAmount) return 0;
  const raw = (inv.shippingTax / inv.shippingAmount) * 100;
  return SLABS.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 0);
}

const invoiceTax = (inv: ReportInvoice) => r2(inv.cgstAmount + inv.sgstAmount + inv.igstAmount + inv.shippingTax);
const invoiceTaxable = (inv: ReportInvoice) => r2(inv.taxableAmount + inv.shippingAmount);

// Numeric tail of an invoice number, for ordering within a series ("INV-0012" → 12)
const serialOf = (n: string) => parseInt(n.match(/(\d+)\D*$/)?.[1] ?? "0", 10);
const seriesOf = (n: string) => n.replace(/(\d+)(\D*)$/, "").trim();

export function buildGstReport(invoices: ReportInvoice[], seller: Seller) {
  // Unknown place of supply (no address) → seller's state, the rule for an unregistered buyer
  // with no address on record. Counted so the merchant can review them.
  let unknownPos = 0;
  const pos = (inv: ReportInvoice) => {
    if (inv.placeOfSupply && STATE_CODES[inv.placeOfSupply]) return inv.placeOfSupply;
    unknownPos++;
    return seller.stateCode;
  };

  const b2b: Array<Record<string, string | number>> = [];
  const b2cl: Array<Record<string, string | number>> = [];
  const b2csMap = new Map<string, { pos: string; rate: number; taxable: number; igst: number; cgst: number; sgst: number }>();
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  const interStateUnregistered = new Map<string, { pos: string; taxable: number; igst: number }>();
  const outward = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  let nilRated = 0;
  const nilTable = { interRegistered: 0, intraRegistered: 0, interUnregistered: 0, intraUnregistered: 0 };
  let missingHsnLines = 0;
  let b2bCount = 0, b2clCount = 0, b2csCount = 0;
  const invoiceRows: Array<{
    id: string; number: string; date: string; buyer: string; gstin: string; pos: string;
    section: "B2B" | "B2C Large" | "B2C Small"; taxable: number; gst: number; total: number;
  }> = [];

  for (const inv of invoices) {
    const place = pos(inv);
    const isB2B = !!inv.buyerGstin && validateGstin(inv.buyerGstin);
    const interState = place !== seller.stateCode;
    const allBuckets = rateBuckets(inv);
    // 0% (nil rated) supplies are reported in Table 8, not in B2B / B2CL / B2CS
    const buckets = allBuckets.filter((b) => b.rate > 0);
    for (const b of allBuckets) {
      if (b.rate !== 0) continue;
      const key = `${interState ? "inter" : "intra"}${isB2B ? "Registered" : "Unregistered"}` as keyof typeof nilTable;
      nilTable[key] += b.taxable;
    }

    // Per-invoice view for the "All invoices" list — same section decision as the return itself
    invoiceRows.push({
      id: inv.id, number: inv.invoiceNumber, date: portalDate(inv.invoiceDate), buyer: inv.buyerName || "Guest",
      gstin: isB2B ? inv.buyerGstin! : "", pos: posLabel(place),
      section: isB2B ? "B2B" : interState && inv.totalAmount > B2CL_THRESHOLD ? "B2C Large" : "B2C Small",
      taxable: invoiceTaxable(inv), gst: invoiceTax(inv), total: r2(inv.totalAmount),
    });

    // ── GSTR-1 sections ──
    if (isB2B) {
      b2bCount++;
      for (const b of buckets) {
        b2b.push({
          gstin: inv.buyerGstin!, name: inv.buyerName || "", number: inv.invoiceNumber,
          date: portalDate(inv.invoiceDate), value: r2(inv.totalAmount), pos: posLabel(place),
          rate: b.rate, taxable: b.taxable, igst: b.igst, cgst: b.cgst, sgst: b.sgst,
        });
      }
    } else if (interState && inv.totalAmount > B2CL_THRESHOLD) {
      b2clCount++;
      for (const b of buckets) {
        b2cl.push({
          number: inv.invoiceNumber, date: portalDate(inv.invoiceDate), value: r2(inv.totalAmount),
          pos: posLabel(place), rate: b.rate, taxable: b.taxable, igst: b.igst,
        });
      }
    } else {
      b2csCount++;
      for (const b of buckets) {
        const key = `${place}|${b.rate}`;
        const row = b2csMap.get(key) ?? { pos: place, rate: b.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        row.taxable += b.taxable; row.igst += b.igst; row.cgst += b.cgst; row.sgst += b.sgst;
        b2csMap.set(key, row);
      }
    }

    // ── HSN summary (Table 12, split B2B / B2C) — one row per HSN + rate ──
    const target = isB2B ? hsn.b2b : hsn.b2c;
    for (const li of inv.lineItems) {
      if (!li.hsnCode) missingHsnLines++;
      addHsn(target, li.hsnCode || "", li.productName, "NOS-NUMBERS", li.quantity, lineRate(li),
        li.taxableValue, li.igstAmount, li.cgstAmount, li.sgstAmount);
    }
    if (inv.shippingAmount > 0) {
      const t = splitTax(inv.shippingTax, inv.taxType === "IGST");
      // Services carry no quantity on the HSN table
      addHsn(target, seller.shippingSac, "Shipping / delivery charges", "NA", 0, shippingRate(inv),
        inv.shippingAmount, t.igst, t.cgst, t.sgst);
    }

    // ── GSTR-3B ──
    for (const b of allBuckets) {
      if (b.rate === 0) { nilRated += b.taxable; continue; }
      outward.taxable += b.taxable; outward.igst += b.igst; outward.cgst += b.cgst; outward.sgst += b.sgst;
      // Table 3.2: inter-state supplies to unregistered persons, by state
      if (!isB2B && interState) {
        const row = interStateUnregistered.get(place) ?? { pos: place, taxable: 0, igst: 0 };
        row.taxable += b.taxable; row.igst += b.igst;
        interStateUnregistered.set(place, row);
      }
    }
  }

  // ── Table 13: documents issued, per invoice number series ──
  const seriesMap = new Map<string, string[]>();
  for (const inv of invoices) {
    const s = seriesOf(inv.invoiceNumber);
    seriesMap.set(s, [...(seriesMap.get(s) ?? []), inv.invoiceNumber]);
  }
  const documents = Array.from(seriesMap.values()).map((nums) => {
    const sorted = [...nums].sort((a, b) => serialOf(a) - serialOf(b));
    return { from: sorted[0], to: sorted[sorted.length - 1], total: nums.length, cancelled: 0 };
  });

  const round = <T extends Record<string, unknown>>(o: T) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v])) as T;

  return {
    totals: {
      invoices: invoices.length,
      taxable: r2(invoices.reduce((s, i) => s + invoiceTaxable(i), 0)),
      gst: r2(invoices.reduce((s, i) => s + invoiceTax(i), 0)),
      total: r2(invoices.reduce((s, i) => s + i.totalAmount, 0)),
    },
    counts: { b2b: b2bCount, b2cl: b2clCount, b2cs: b2csCount },
    invoices: invoiceRows,
    b2b,
    b2cl,
    b2cs: Array.from(b2csMap.values()).map(round).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate),
    hsnB2B: Array.from(hsn.b2b.values()).map(round),
    hsnB2C: Array.from(hsn.b2c.values()).map(round),
    nilRated: round(nilTable),
    documents,
    gstr3b: {
      outward: round(outward),
      nilRated: r2(nilRated),
      interStateUnregistered: Array.from(interStateUnregistered.values()).map(round).sort((a, b) => a.pos.localeCompare(b.pos)),
    },
    warnings: { unknownPos, missingHsnLines },
  };
}

type HsnRow = {
  hsn: string; description: string; uqc: string; quantity: number; rate: number;
  totalValue: number; taxable: number; igst: number; cgst: number; sgst: number;
};

function addHsn(
  map: Map<string, HsnRow>, hsn: string, description: string, uqc: string, qty: number, rate: number,
  taxable: number, igst: number, cgst: number, sgst: number,
) {
  const key = `${hsn}|${rate}`;
  const row = map.get(key) ?? { hsn, description, uqc, quantity: 0, rate, totalValue: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  row.quantity += qty;
  row.taxable += taxable;
  row.igst += igst; row.cgst += cgst; row.sgst += sgst;
  // "Total Value" on the HSN table is the value including tax
  row.totalValue += taxable + igst + cgst + sgst;
  map.set(key, row);
}

// ─── CSV (Offline Tool templates) ────────────────────────────────────────────

const csv = (rows: Array<Array<string | number>>) =>
  "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

export type GstReport = ReturnType<typeof buildGstReport>;

export const reportCsv = {
  b2b: (r: GstReport) => csv([
    ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply",
      "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
    ...r.b2b.map((x) => [x.gstin, x.name, x.number, x.date, x.value, x.pos, "N", "", "Regular B2B", "", x.rate, x.taxable, 0]),
  ]),
  b2cl: (r: GstReport) => csv([
    ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
    ...r.b2cl.map((x) => [x.number, x.date, x.value, x.pos, "", x.rate, x.taxable, 0, ""]),
  ]),
  b2cs: (r: GstReport) => csv([
    ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
    ...r.b2cs.map((x) => ["OE", posLabel(x.pos), "", x.rate, x.taxable, 0, ""]),
  ]),
  hsn: (rows: GstReport["hsnB2B"]) => csv([
    ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value",
      "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
    ...rows.map((x) => [x.hsn, x.description, x.uqc, x.quantity, x.totalValue, x.rate, x.taxable, x.igst, x.cgst, x.sgst, 0]),
  ]),
  // Table 8 — nil rated / exempt / non-GST supplies (exempt and non-GST aren't tracked separately)
  nil: (r: GstReport) => csv([
    ["Description", "Nil Rated Supplies", "Exempted(other than nil rated/non GST supply)", "Non-GST Supplies"],
    ["Inter-State supplies to registered persons", r.nilRated.interRegistered, 0, 0],
    ["Intra-State supplies to registered persons", r.nilRated.intraRegistered, 0, 0],
    ["Inter-State supplies to unregistered persons", r.nilRated.interUnregistered, 0, 0],
    ["Intra-State supplies to unregistered persons", r.nilRated.intraUnregistered, 0, 0],
  ]),
  docs: (r: GstReport) => csv([
    ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
    ...r.documents.map((d) => ["Invoices for outward supply", d.from, d.to, d.total, d.cancelled]),
  ]),
  gstr3b: (r: GstReport) => csv([
    ["Table", "Nature of Supplies", "Total Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"],
    ["3.1(a)", "Outward taxable supplies (other than zero rated, nil rated and exempted)", r.gstr3b.outward.taxable, r.gstr3b.outward.igst, r.gstr3b.outward.cgst, r.gstr3b.outward.sgst, 0],
    ["3.1(c)", "Other outward supplies (Nil rated, exempted)", r.gstr3b.nilRated, 0, 0, 0, 0],
    [],
    ["Table", "Place of Supply (State/UT)", "Taxable Value", "Integrated Tax"],
    ...r.gstr3b.interStateUnregistered.map((x) => ["3.2", posLabel(x.pos), x.taxable, x.igst]),
  ]),
};
