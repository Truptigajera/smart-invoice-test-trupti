import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Button, Tabs, TextField,
  IndexTable, EmptyState, Banner, Box, Divider, Badge, Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";
import { buildGstReport, reportCsv, posLabel, type GstReport, type ReportInvoice } from "~/lib/gst-reports";
import { openUpgradePopup } from "~/components/PlanLimitModal";

// ─── Dates (always the Indian calendar day, never UTC) ───────────────────────

// yyyy-mm-dd for a local date. The old code used toISOString(), which in India shifts to the
// previous day — "This month" started on the 30th and ended a day early.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const istEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);

type Range = { from: string; to: string };
function quickRange(kind: "month" | "last-month" | "quarter" | "last-quarter" | "fy"): Range {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (kind === "month") return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "last-month") return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  if (kind === "quarter" || kind === "last-quarter") {
    const q = Math.floor(m / 3) - (kind === "last-quarter" ? 1 : 0);
    return { from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)) };
  }
  // Indian financial year: April – March
  const fy = m >= 3 ? y : y - 1;
  return { from: ymd(new Date(fy, 3, 1)), to: ymd(new Date(fy + 1, 2, 31)) };
}

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const def = quickRange("month");
  const from = url.searchParams.get("from") || def.from;
  const to = url.searchParams.get("to") || def.to;

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, include: { settings: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const invoiceDate = { gte: istStart(from), lte: istEnd(to) };
  const [invoices, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { shopId: shop.id, invoiceDate, invoiceType: { not: "CREDIT_NOTE" } },
      include: { lineItems: true },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.invoice.count({ where: { shopId: shop.id, invoiceDate, invoiceType: "CREDIT_NOTE" } }),
  ]);

  const report = buildGstReport(invoices as unknown as ReportInvoice[], {
    gstin: shop.gstin || "",
    stateCode: shop.stateCode || (shop.gstin || "").slice(0, 2),
    shippingSac: shop.settings?.shippingHsnCode || "996812",
  });

  // Light invoice list for the Tally export
  const invoiceList = invoices.map((i) => ({
    id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate.toISOString(),
    buyerName: i.buyerName, buyerGstin: i.buyerGstin, placeOfSupply: i.placeOfSupply,
    taxable: i.taxableAmount, shipping: i.shippingAmount, shippingTax: i.shippingTax,
    igst: i.igstAmount, cgst: i.cgstAmount, sgst: i.sgstAmount, total: i.totalAmount, taxType: i.taxType,
  }));

  return json({
    from, to, report, invoiceList, creditNotes,
    shopGstin: shop.gstin || "",
    shopName: shop.businessName || shop.shopDomain,
    canReports: canUseFeature(shop.currentPlan, "gstr-reports"),
    canTally: canUseFeature(shop.currentPlan, "tally-export"),
  });
};

// ─── Tally XML ────────────────────────────────────────────────────────────────

type InvoiceRow = {
  id: string; invoiceNumber: string; invoiceDate: string; buyerName: string | null; buyerGstin: string | null;
  placeOfSupply: string | null; taxable: number; shipping: number; shippingTax: number;
  igst: number; cgst: number; sgst: number; total: number; taxType: string;
};

function buildTallyXML(invoices: InvoiceRow[], shopName: string): string {
  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // yyyymmdd in Indian time
  const tallyDate = (d: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(d)).replace(/-/g, "");
  const entry = (ledger: string, amount: number, positive: boolean) =>
    `        <ALLLEDGERENTRIES.LIST>\n          <LEDGERNAME>${esc(ledger)}</LEDGERNAME>\n          <ISDEEMEDPOSITIVE>${positive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>\n          <AMOUNT>${amount.toFixed(2)}</AMOUNT>\n        </ALLLEDGERENTRIES.LIST>`;

  const messages = invoices.map((inv) => {
    // B2B sales go to the buyer's party ledger; retail (B2C) sales to a single "Cash" ledger,
    // so Tally isn't flooded with one ledger per shopper
    const party = inv.buyerGstin ? (inv.buyerName || "Cash") : "Cash";
    // Shipping tax is split the same way as the invoice's tax
    const shipIgst = inv.taxType === "IGST" ? inv.shippingTax : 0;
    const shipCgst = inv.taxType === "IGST" ? 0 : Math.floor(Math.round(inv.shippingTax * 100) / 2) / 100;
    const shipSgst = inv.taxType === "IGST" ? 0 : r2(inv.shippingTax - shipCgst);
    const sales = r2(inv.taxable), shipping = r2(inv.shipping);
    const igst = r2(inv.igst + shipIgst), cgst = r2(inv.cgst + shipCgst), sgst = r2(inv.sgst + shipSgst);
    // Party total from the parts so the voucher always balances (shipping was missing before)
    const total = r2(sales + shipping + igst + cgst + sgst);

    const lines = [
      entry(party, -total, true),
      entry("Sales Account", sales, false),
      ...(shipping > 0 ? [entry("Shipping Charges", shipping, false)] : []),
      ...(igst > 0 ? [entry("Output IGST", igst, false)] : []),
      ...(cgst > 0 ? [entry("Output CGST", cgst, false)] : []),
      ...(sgst > 0 ? [entry("Output SGST", sgst, false)] : []),
    ].join("\n");

    return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${tallyDate(inv.invoiceDate)}</DATE>
        <GUID>${esc(inv.id)}</GUID>
        <NARRATION>${esc(inv.invoiceNumber)} – ${esc(shopName)}</NARRATION>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(inv.invoiceNumber)}</VOUCHERNUMBER>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>${inv.buyerGstin ? `\n        <PARTYGSTIN>${esc(inv.buyerGstin)}</PARTYGSTIN>` : ""}
${lines}
      </VOUCHER>
    </TALLYMESSAGE>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY></SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// ─── Downloads ────────────────────────────────────────────────────────────────

function saveFile(content: string | Blob, filename: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Each GSTR-1 section as the Offline Tool expects it
const GSTR1_FILES: Array<{ file: string; build: (r: GstReport) => string }> = [
  { file: "b2b", build: reportCsv.b2b },
  { file: "b2cl", build: reportCsv.b2cl },
  { file: "b2cs", build: reportCsv.b2cs },
  { file: "exemp", build: reportCsv.nil },
  { file: "hsn-b2b", build: (r) => reportCsv.hsn(r.hsnB2B) },
  { file: "hsn-b2c", build: (r) => reportCsv.hsn(r.hsnB2C) },
  { file: "docs", build: reportCsv.docs },
];

const proPopup = (what: string) =>
  openUpgradePopup({
    title: `${what} is a Pro feature`,
    lines: [
      "Download ready-to-upload files for your GST return — they match the GST portal's Offline Tool, so you (or your CA) can import them directly.",
      "You can still see every number on this page on the Free plan.",
    ],
  });

// ─── Component ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "all", label: "All invoices" },
  { id: "b2b", label: "B2B" },
  { id: "b2cl", label: "B2C Large" },
  { id: "b2cs", label: "B2C Small" },
  { id: "nil", label: "Nil rated" },
  { id: "hsn", label: "HSN Summary" },
  { id: "docs", label: "Documents" },
  { id: "gstr3b", label: "GSTR-3B" },
] as const;

export default function ReportsPage() {
  const { from, to, report, invoiceList, creditNotes, shopGstin, shopName, canReports, canTally } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const [fromVal, setFromVal] = useState(from);
  const [toVal, setToVal] = useState(to);
  const [zipping, setZipping] = useState(false);
  useEffect(() => { setFromVal(from); setToVal(to); }, [from, to]);

  const applyRange = useCallback((r: Range) => {
    const p = new URLSearchParams(searchParams);
    p.set("from", r.from);
    p.set("to", r.to);
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  const period = `${from}-to-${to}`;
  const downloadCsv = (build: (r: GstReport) => string, name: string) => {
    if (!canReports) return proPopup("GST return files");
    saveFile(build(report), `gstr1-${name}-${period}.csv`, "text/csv;charset=utf-8;");
  };

  // All GSTR-1 sections in one ZIP — one click for the monthly return
  const downloadAll = async () => {
    if (!canReports) return proPopup("GST return files");
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of GSTR1_FILES) zip.file(`${f.file}.csv`, f.build(report));
      zip.file("gstr3b.csv", reportCsv.gstr3b(report));
      saveFile(await zip.generateAsync({ type: "blob" }), `gstr1-${period}.zip`, "application/zip");
    } finally {
      setZipping(false);
    }
  };

  const downloadTally = () => {
    if (!canTally) return proPopup("Tally export");
    saveFile(buildTallyXML(invoiceList, shopName), `tally-sales-${period}.xml`, "application/xml;charset=utf-8;");
  };

  const activeQuick = (["month", "last-month", "quarter", "last-quarter", "fy"] as const)
    .find((k) => { const r = quickRange(k); return r.from === from && r.to === to; });

  const counts: Record<string, number> = {
    all: report.invoices.length,
    b2b: report.counts.b2b, b2cl: report.counts.b2cl, b2cs: report.b2cs.length,
    hsn: report.hsnB2B.length + report.hsnB2C.length, docs: report.documents.length,
  };
  const tabs = TABS.map((t) => ({ id: t.id, content: counts[t.id] !== undefined ? `${t.label} (${counts[t.id]})` : t.label }));
  const tab = TABS[selectedTab].id;

  // "Check before filing" — things that make the return wrong if left alone
  const warnings: Array<{ text: string; action?: { content: string; url: string } }> = [];
  if (!shopGstin) warnings.push({ text: "Your GSTIN is not set — returns can't be filed without it.", action: { content: "Add GSTIN", url: "/app/settings" } });
  if (report.warnings.missingHsnLines) warnings.push({ text: `${report.warnings.missingHsnLines} invoice line(s) have no HSN code — the HSN summary needs one for every product.`, action: { content: "Add HSN codes", url: "/app/products?tab=missing" } });
  if (report.warnings.unknownPos) warnings.push({ text: `${report.warnings.unknownPos} invoice(s) have no customer state, so your own state was used as the place of supply. Check those orders' addresses.` });
  if (creditNotes) warnings.push({ text: `${creditNotes} credit note(s) (refunds) in this period are not included yet — adjust them in the return (CDNR / CDNUR) with your CA.` });

  const cell = (v: string | number, bold = false) => (
    <Text as="span" variant="bodySm" fontWeight={bold ? "semibold" : undefined}>{typeof v === "number" ? fmt(v) : v}</Text>
  );
  const pct = (r: number) => cell(`${r}%`);

  // Section header: what it is (in plain words) + its download
  const sectionHeader = (text: string, download?: () => void) => (
    <Box padding="400">
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
        <Text as="p" variant="bodySm" tone="subdued">{text}</Text>
        {download && <Button size="slim" onClick={download}>Download CSV</Button>}
      </InlineStack>
    </Box>
  );
  const nothing = (text: string) => <Box padding="400"><Text as="p" variant="bodySm" tone="subdued">{text}</Text></Box>;

  return (
    <Page
      title="GST Reports"
      fullWidth
      primaryAction={{ content: zipping ? "Preparing…" : "Download all GSTR-1 files", onAction: downloadAll, disabled: zipping || report.totals.invoices === 0 }}
      secondaryActions={[{ content: "Tally XML", onAction: downloadTally, disabled: report.totals.invoices === 0 }]}
    >
      <TitleBar title="GST Reports" />
      <BlockStack gap="400">

        {/* Period */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="end" wrap>
              <Button size="slim" pressed={activeQuick === "month"} onClick={() => applyRange(quickRange("month"))}>This month</Button>
              <Button size="slim" pressed={activeQuick === "last-month"} onClick={() => applyRange(quickRange("last-month"))}>Last month</Button>
              <Button size="slim" pressed={activeQuick === "quarter"} onClick={() => applyRange(quickRange("quarter"))}>This quarter</Button>
              <Button size="slim" pressed={activeQuick === "last-quarter"} onClick={() => applyRange(quickRange("last-quarter"))}>Last quarter</Button>
              <Button size="slim" pressed={activeQuick === "fy"} onClick={() => applyRange(quickRange("fy"))}>This FY</Button>
              <div style={{ width: 150 }}>
                <TextField label="From" labelHidden type="date" value={fromVal} onChange={setFromVal} autoComplete="off" />
              </div>
              <div style={{ width: 150 }}>
                <TextField label="To" labelHidden type="date" value={toVal} onChange={setToVal} autoComplete="off" />
              </div>
              <Button size="slim" variant="primary" onClick={() => applyRange({ from: fromVal, to: toVal })} disabled={!fromVal || !toVal || (fromVal === from && toVal === to)}>
                Show
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Period: {fmtDate(from)} – {fmtDate(to)}{shopGstin && ` · GSTIN: ${shopGstin}`}
            </Text>
          </BlockStack>
        </Card>

        {warnings.length > 0 && (
          <Banner tone="warning" title="Check before filing">
            <BlockStack gap="150">
              {warnings.map((w) => (
                <InlineStack key={w.text} gap="200" blockAlign="center" wrap={false}>
                  <Text as="p" variant="bodySm">• {w.text}</Text>
                  {w.action && <Button size="micro" variant="plain" url={w.action.url}>{w.action.content}</Button>}
                </InlineStack>
              ))}
            </BlockStack>
          </Banner>
        )}

        {/* Totals */}
        <Card>
          <InlineStack gap="800" wrap>
            {[
              { label: "Invoices", value: String(report.totals.invoices) },
              { label: "Taxable value (incl. shipping)", value: fmt(report.totals.taxable) },
              { label: "Total GST", value: fmt(report.totals.gst) },
              { label: "Invoice total", value: fmt(report.totals.total) },
            ].map((c) => (
              <BlockStack key={c.label} gap="050">
                <Text as="span" variant="bodySm" tone="subdued">{c.label}</Text>
                <Text as="span" variant="headingSm">{c.value}</Text>
              </BlockStack>
            ))}
          </InlineStack>
        </Card>

        {report.totals.invoices === 0 ? (
          <Card>
            <EmptyState heading="No invoices in this period" image="">
              <Text as="p" variant="bodySm" tone="subdued">Pick another period above.</Text>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Divider />

              {tab === "all" && (
                <>
                  {sectionHeader("Every invoice in this period, and the part of GSTR-1 it is reported in. B2C Small invoices are added up by state and rate in the return, so open that tab to see the totals.")}
                  <IndexTable
                    resourceName={{ singular: "invoice", plural: "invoices" }} itemCount={report.invoices.length} selectable={false}
                    headings={[{ title: "Invoice" }, { title: "Date" }, { title: "Buyer" }, { title: "Buyer GSTIN" }, { title: "Place of supply" }, { title: "Reported in" }, { title: "Taxable" }, { title: "GST" }, { title: "Total" }]}
                  >
                    {report.invoices.map((r, i) => (
                      <IndexTable.Row id={r.id} key={r.id} position={i}>
                        <IndexTable.Cell>
                          <Link url={`/app/invoices/${r.id}`} monochrome removeUnderline>{cell(r.number, true)}</Link>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.date)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.buyer)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.gstin || "—")}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.pos)}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={r.section === "B2B" ? "success" : r.section === "B2C Large" ? "attention" : "info"}>{r.section}</Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.taxable)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.gst)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(r.total)}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}

              {tab === "b2b" && (
                <>
                  {sectionHeader("GSTR-1 Table 4 — sales to GST-registered buyers (with GSTIN), one row per invoice and GST rate.", () => downloadCsv(reportCsv.b2b, "b2b"))}
                  {report.b2b.length === 0 ? nothing("No B2B invoices in this period. Invoices get a buyer GSTIN from B2B Customers or the checkout GSTIN field.") : (
                    <IndexTable
                      resourceName={{ singular: "row", plural: "rows" }} itemCount={report.b2b.length} selectable={false}
                      headings={[{ title: "Buyer GSTIN" }, { title: "Buyer" }, { title: "Invoice" }, { title: "Date" }, { title: "Place of supply" }, { title: "Rate" }, { title: "Taxable" }, { title: "IGST" }, { title: "CGST" }, { title: "SGST" }, { title: "Invoice value" }]}
                    >
                      {report.b2b.map((r, i) => (
                        <IndexTable.Row id={`${r.number}-${r.rate}`} key={`${r.number}-${r.rate}`} position={i}>
                          <IndexTable.Cell>{cell(String(r.gstin))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.name) || "—")}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.number), true)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.date))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.pos))}</IndexTable.Cell>
                          <IndexTable.Cell>{pct(Number(r.rate))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.taxable))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.igst))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.cgst))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.sgst))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.value))}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </>
              )}

              {tab === "b2cl" && (
                <>
                  {sectionHeader("GSTR-1 Table 5 — sales to buyers without GSTIN in another state, where the invoice is above ₹1 lakh. These are reported invoice by invoice.", () => downloadCsv(reportCsv.b2cl, "b2cl"))}
                  {report.b2cl.length === 0 ? nothing("None in this period — most stores have no B2C Large invoices.") : (
                    <IndexTable
                      resourceName={{ singular: "row", plural: "rows" }} itemCount={report.b2cl.length} selectable={false}
                      headings={[{ title: "Invoice" }, { title: "Date" }, { title: "Place of supply" }, { title: "Rate" }, { title: "Taxable" }, { title: "IGST" }, { title: "Invoice value" }]}
                    >
                      {report.b2cl.map((r, i) => (
                        <IndexTable.Row id={`${r.number}-${r.rate}`} key={`${r.number}-${r.rate}`} position={i}>
                          <IndexTable.Cell>{cell(String(r.number), true)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.date))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(String(r.pos))}</IndexTable.Cell>
                          <IndexTable.Cell>{pct(Number(r.rate))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.taxable))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.igst))}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(Number(r.value))}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </>
              )}

              {tab === "b2cs" && (
                <>
                  {sectionHeader("GSTR-1 Table 7 — all other sales to buyers without GSTIN, added up by state and GST rate.", () => downloadCsv(reportCsv.b2cs, "b2cs"))}
                  {report.b2cs.length === 0 ? nothing("No B2C sales in this period.") : (
                    <IndexTable
                      resourceName={{ singular: "row", plural: "rows" }} itemCount={report.b2cs.length} selectable={false}
                      headings={[{ title: "Place of supply" }, { title: "Rate" }, { title: "Taxable" }, { title: "IGST" }, { title: "CGST" }, { title: "SGST" }]}
                    >
                      {report.b2cs.map((r, i) => (
                        <IndexTable.Row id={`${r.pos}-${r.rate}`} key={`${r.pos}-${r.rate}`} position={i}>
                          <IndexTable.Cell>{cell(posLabel(r.pos), true)}</IndexTable.Cell>
                          <IndexTable.Cell>{pct(r.rate)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.taxable)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.igst)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.cgst)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.sgst)}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </>
              )}

              {tab === "nil" && (
                <>
                  {sectionHeader("GSTR-1 Table 8 — sales of 0% GST (nil rated) items.", () => downloadCsv(reportCsv.nil, "exemp"))}
                  <IndexTable
                    resourceName={{ singular: "row", plural: "rows" }} itemCount={4} selectable={false}
                    headings={[{ title: "Description" }, { title: "Nil rated value" }]}
                  >
                    {([
                      ["Inter-state, to registered buyers", report.nilRated.interRegistered],
                      ["Intra-state, to registered buyers", report.nilRated.intraRegistered],
                      ["Inter-state, to unregistered buyers", report.nilRated.interUnregistered],
                      ["Intra-state, to unregistered buyers", report.nilRated.intraUnregistered],
                    ] as const).map(([label, v], i) => (
                      <IndexTable.Row id={label} key={label} position={i}>
                        <IndexTable.Cell>{cell(label)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(v)}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}

              {tab === "hsn" && (
                <>
                  {sectionHeader("GSTR-1 Table 12 — totals per HSN code and GST rate, split into B2B and B2C as the portal requires.")}
                  {(["hsnB2B", "hsnB2C"] as const).map((k) => (
                    <BlockStack key={k} gap="0">
                      <Box paddingInline="400" paddingBlock="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingXs">{k === "hsnB2B" ? "B2B (to registered buyers)" : "B2C (to unregistered buyers)"}</Text>
                          <Button size="slim" onClick={() => downloadCsv((r) => reportCsv.hsn(r[k]), k === "hsnB2B" ? "hsn-b2b" : "hsn-b2c")}>Download CSV</Button>
                        </InlineStack>
                      </Box>
                      {report[k].length === 0 ? nothing("No sales in this group.") : (
                        <IndexTable
                          resourceName={{ singular: "HSN row", plural: "HSN rows" }} itemCount={report[k].length} selectable={false}
                          headings={[{ title: "HSN" }, { title: "Description" }, { title: "UQC" }, { title: "Qty" }, { title: "Rate" }, { title: "Taxable" }, { title: "IGST" }, { title: "CGST" }, { title: "SGST" }, { title: "Total value" }]}
                        >
                          {report[k].map((r, i) => (
                            <IndexTable.Row id={`${k}-${r.hsn}-${r.rate}`} key={`${r.hsn}-${r.rate}`} position={i}>
                              <IndexTable.Cell>
                                <Text as="span" variant="bodySm" fontWeight="semibold" tone={r.hsn ? undefined : "critical"}>{r.hsn || "Missing"}</Text>
                              </IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.description)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.uqc)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(String(r.quantity))}</IndexTable.Cell>
                              <IndexTable.Cell>{pct(r.rate)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.taxable)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.igst)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.cgst)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.sgst)}</IndexTable.Cell>
                              <IndexTable.Cell>{cell(r.totalValue)}</IndexTable.Cell>
                            </IndexTable.Row>
                          ))}
                        </IndexTable>
                      )}
                    </BlockStack>
                  ))}
                </>
              )}

              {tab === "docs" && (
                <>
                  {sectionHeader("GSTR-1 Table 13 — the range of invoice numbers you issued in this period.", () => downloadCsv(reportCsv.docs, "docs"))}
                  <IndexTable
                    resourceName={{ singular: "series", plural: "series" }} itemCount={report.documents.length} selectable={false}
                    headings={[{ title: "Document" }, { title: "From" }, { title: "To" }, { title: "Total" }, { title: "Cancelled" }]}
                  >
                    {report.documents.map((d, i) => (
                      <IndexTable.Row id={d.from} key={d.from} position={i}>
                        <IndexTable.Cell>{cell("Invoices for outward supply")}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(d.from, true)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(d.to, true)}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(String(d.total))}</IndexTable.Cell>
                        <IndexTable.Cell>{cell(String(d.cancelled))}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}

              {tab === "gstr3b" && (
                <>
                  {sectionHeader("GSTR-3B — your monthly tax summary. Copy these numbers into Tables 3.1 and 3.2 on the GST portal.", () => downloadCsv(reportCsv.gstr3b, "gstr3b"))}
                  <IndexTable
                    resourceName={{ singular: "row", plural: "rows" }} itemCount={2} selectable={false}
                    headings={[{ title: "Table 3.1 — Nature of supplies" }, { title: "Taxable value" }, { title: "IGST" }, { title: "CGST" }, { title: "SGST" }]}
                  >
                    <IndexTable.Row id="31a" position={0}>
                      <IndexTable.Cell>{cell("(a) Outward taxable supplies", true)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell(report.gstr3b.outward.taxable)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell(report.gstr3b.outward.igst)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell(report.gstr3b.outward.cgst)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell(report.gstr3b.outward.sgst)}</IndexTable.Cell>
                    </IndexTable.Row>
                    <IndexTable.Row id="31c" position={1}>
                      <IndexTable.Cell>{cell("(c) Nil rated / exempted supplies", true)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell(report.gstr3b.nilRated)}</IndexTable.Cell>
                      <IndexTable.Cell>{cell("—")}</IndexTable.Cell>
                      <IndexTable.Cell>{cell("—")}</IndexTable.Cell>
                      <IndexTable.Cell>{cell("—")}</IndexTable.Cell>
                    </IndexTable.Row>
                  </IndexTable>
                  <Box padding="400"><Divider /></Box>
                  <Box paddingInline="400" paddingBlockEnd="200">
                    <Text as="h3" variant="headingXs">Table 3.2 — Inter-state sales to unregistered buyers, by state</Text>
                  </Box>
                  {report.gstr3b.interStateUnregistered.length === 0 ? nothing("No inter-state B2C sales in this period.") : (
                    <IndexTable
                      resourceName={{ singular: "state", plural: "states" }} itemCount={report.gstr3b.interStateUnregistered.length} selectable={false}
                      headings={[{ title: "Place of supply" }, { title: "Taxable value" }, { title: "IGST" }]}
                    >
                      {report.gstr3b.interStateUnregistered.map((r, i) => (
                        <IndexTable.Row id={r.pos} key={r.pos} position={i}>
                          <IndexTable.Cell>{cell(posLabel(r.pos), true)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.taxable)}</IndexTable.Cell>
                          <IndexTable.Cell>{cell(r.igst)}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </>
              )}
            </Tabs>
          </Card>
        )}

        {/* Tally */}
        {report.totals.invoices > 0 && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingXs">Tally export</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Imports {report.totals.invoices} sales voucher(s) into Tally. Create these ledgers first: <strong>Sales Account</strong>,{" "}
                  <strong>Shipping Charges</strong>, <strong>Output CGST</strong>, <strong>Output SGST</strong>, <strong>Output IGST</strong> and{" "}
                  <strong>Cash</strong> (used for retail sales; B2B sales use the buyer&apos;s name as the party ledger).
                </Text>
              </BlockStack>
              <Button onClick={downloadTally}>Download Tally XML</Button>
            </InlineStack>
          </Card>
        )}

        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Files follow the GST portal&apos;s Offline Tool format. Please have your CA review them before your first filing.
        </Text>
      </BlockStack>
    </Page>
  );
}
