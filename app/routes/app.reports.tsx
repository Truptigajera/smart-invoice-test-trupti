import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Button, Tabs,
  IndexTable, EmptyState, Badge, Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { canUseFeature } from "~/lib/plan-features";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function r2(n: number) { return Math.round(n * 100) / 100; }
function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function isoDate(d: Date) { return d.toISOString().split("T")[0]; }

function monthRange(offset = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}
function quarterRange(offset = 0) {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + offset;
  const y = now.getFullYear() + Math.floor(q / 4);
  const qAdj = ((q % 4) + 4) % 4;
  const from = new Date(y, qAdj * 3, 1);
  const to = new Date(y, qAdj * 3 + 3, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

// ─── CSV builders ─────────────────────────────────────────────────────────────

function buildB2BCSV(invoices: any[], shopGstin: string) {
  const rows = [
    ["GSTIN of Supplier", "Invoice Number", "Invoice Date", "Invoice Value", "Place of Supply",
      "Reverse Charge", "Invoice Type", "Rate", "Taxable Value",
      "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
  ];
  for (const inv of invoices.filter((i: any) => i.buyerGstin)) {
    rows.push([
      shopGstin, inv.invoiceNumber, fmtDate(inv.invoiceDate),
      r2(inv.totalAmount), inv.placeOfSupply || "",
      inv.reverseCharge ? "Y" : "N", "Regular",
      "", r2(inv.taxableAmount),
      r2(inv.igstAmount), r2(inv.cgstAmount), r2(inv.sgstAmount), "0",
    ]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildB2CCSV(invoices: any[]) {
  const rows = [
    ["Type", "Place of Supply", "Rate", "Taxable Value",
      "Integrated Tax Amount", "Central/State Tax Amount", "Cess Amount"],
  ];
  for (const inv of invoices.filter((i: any) => !i.buyerGstin)) {
    rows.push([
      "OE", inv.placeOfSupply || "", "",
      r2(inv.taxableAmount), r2(inv.igstAmount),
      r2(inv.cgstAmount + inv.sgstAmount), "0",
    ]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildHSNCSV(hsnMap: Map<string, any>) {
  const rows = [
    ["HSN", "Description", "UQC", "Total Quantity", "Total Value",
      "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount"],
  ];
  for (const [hsn, d] of hsnMap) {
    rows.push([
      hsn, d.name, "NOS",
      r2(d.qty), r2(d.taxableValue),
      r2(d.igst), r2(d.cgst), r2(d.sgst),
    ]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildGSTR3BCSV(summary: any) {
  const rows = [
    ["Nature of Supplies", "Total Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax"],
    ["Outward Taxable Supplies", r2(summary.taxableValue), r2(summary.igst), r2(summary.cgst), r2(summary.sgst)],
    ["Zero Rated / Exports", r2(summary.exportValue), "0", "0", "0"],
    ["Nil Rated / Exempt", "0", "0", "0", "0"],
    ["TOTAL", r2(summary.taxableValue + summary.exportValue), r2(summary.igst), r2(summary.cgst), r2(summary.sgst)],
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const defFrom = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const defTo = isoDate(new Date());
  const from = url.searchParams.get("from") || defFrom;
  const to = url.searchParams.get("to") || defTo;

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ invoices: [], from, to, shopGstin: "", shopState: "", shopName: "", reportHistory: [], currentPlan: "free" });

  const invoices = await prisma.invoice.findMany({
    where: {
      shopId: shop.id,
      invoiceDate: { gte: new Date(from), lte: new Date(to + "T23:59:59.999Z") },
      invoiceType: { not: "CREDIT_NOTE" },
    },
    include: { lineItems: true },
    orderBy: { invoiceDate: "asc" },
  });

  const reportHistory = await prisma.reportHistory.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reportType: true,
      dateFrom: true,
      dateTo: true,
      fileUrl: true,
      fileName: true,
      createdAt: true,
    },
  });

  return json({ invoices, from, to, shopGstin: shop.gstin || "", shopState: shop.stateCode || "", shopName: (shop as any).businessName || shop.shopDomain, reportHistory, currentPlan: shop.currentPlan });
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  if (intent === "save-report-history") {
    const { reportType, dateFrom, dateTo, fileUrl, fileName } = Object.fromEntries(formData);
    await prisma.reportHistory.create({
      data: {
        shopId: shop.id,
        reportType: reportType as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        fileUrl: (fileUrl as string) || null,
        fileName: (fileName as string) || null,
      },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ─── Data helpers ─────────────────────────────────────────────────────────────

function buildHSNMap(invoices: any[]) {
  const map = new Map<string, { name: string; qty: number; taxableValue: number; igst: number; cgst: number; sgst: number }>();
  for (const inv of invoices) {
    for (const item of inv.lineItems || []) {
      const key = item.hsnCode || "N/A";
      const existing = map.get(key) || { name: item.productName, qty: 0, taxableValue: 0, igst: 0, cgst: 0, sgst: 0 };
      existing.qty += item.quantity;
      existing.taxableValue += item.taxableValue;
      existing.igst += item.igstAmount;
      existing.cgst += item.cgstAmount;
      existing.sgst += item.sgstAmount;
      map.set(key, existing);
    }
  }
  return map;
}

function buildGSTR3BSummary(invoices: any[], sellerStateCode: string) {
  let taxableValue = 0, igst = 0, cgst = 0, sgst = 0, exportValue = 0;
  for (const inv of invoices) {
    const isExport = inv.buyerStateCode === "" || inv.placeOfSupply === "Export";
    if (isExport) {
      exportValue += inv.taxableAmount;
    } else {
      taxableValue += inv.taxableAmount;
      igst += inv.igstAmount;
      cgst += inv.cgstAmount;
      sgst += inv.sgstAmount;
    }
  }
  return { taxableValue, igst, cgst, sgst, exportValue };
}

function buildTallyXML(invoices: any[], shopName: string): string {
  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const tallyDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
  };

  const messages = invoices.map((inv: any) => {
    const party = esc(inv.buyerName || "Cash");
    const taxable = r2(inv.taxableAmount);
    const igst = r2(inv.igstAmount);
    const cgst = r2(inv.cgstAmount);
    const sgst = r2(inv.sgstAmount);
    // Recompute party total from components to guarantee XML balances to 0
    const total = r2(taxable + igst + cgst + sgst);

    const taxLines = [
      ...(igst > 0 ? [`        <ALLLEDGERENTRIES.LIST>\n          <LEDGERNAME>Output IGST</LEDGERNAME>\n          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n          <AMOUNT>${igst.toFixed(2)}</AMOUNT>\n        </ALLLEDGERENTRIES.LIST>`] : []),
      ...(cgst > 0 ? [`        <ALLLEDGERENTRIES.LIST>\n          <LEDGERNAME>Output CGST</LEDGERNAME>\n          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n          <AMOUNT>${cgst.toFixed(2)}</AMOUNT>\n        </ALLLEDGERENTRIES.LIST>`] : []),
      ...(sgst > 0 ? [`        <ALLLEDGERENTRIES.LIST>\n          <LEDGERNAME>Output SGST</LEDGERNAME>\n          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n          <AMOUNT>${sgst.toFixed(2)}</AMOUNT>\n        </ALLLEDGERENTRIES.LIST>`] : []),
    ].join("\n");

    return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${tallyDate(inv.invoiceDate)}</DATE>
        <GUID>${esc(inv.id)}</GUID>
        <NARRATION>${esc(inv.invoiceNumber)} – ${esc(shopName)}</NARRATION>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(inv.invoiceNumber)}</VOUCHERNUMBER>
        <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${party}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${total.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Sales Account</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${taxable.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
${taxLines}
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

// ─── Report type label map ────────────────────────────────────────────────────

const REPORT_TYPE_LABELS: Record<string, string> = {
  "B2B-CSV": "GSTR-1 B2B",
  "B2C-CSV": "GSTR-1 B2C",
  "HSN-CSV": "HSN Summary",
  "GSTR-3B-CSV": "GSTR-3B",
  "TALLY-XML": "Tally Sales XML",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const navigate = useNavigate();
  const { invoices, from, to, shopGstin, shopState, shopName, reportHistory, currentPlan } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const [fromVal, setFromVal] = useState(from);
  const [toVal, setToVal] = useState(to);
  const historyFetcher = useFetcher();

  const tabs = [
    { id: "b2b", content: `B2B Invoices (${invoices.filter((i: any) => i.buyerGstin).length})` },
    { id: "b2c", content: `B2C Invoices (${invoices.filter((i: any) => !i.buyerGstin).length})` },
    { id: "hsn", content: "HSN Summary" },
    { id: "gstr3b", content: "GSTR-3B Summary" },
    { id: "history", content: "Report History" },
  ];

  const handleGenerate = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set("from", fromVal);
    p.set("to", toVal);
    setSearchParams(p);
  }, [fromVal, toVal, searchParams, setSearchParams]);

  const setQuickRange = useCallback((r: { from: string; to: string }) => {
    setFromVal(r.from);
    setToVal(r.to);
    const p = new URLSearchParams(searchParams);
    p.set("from", r.from);
    p.set("to", r.to);
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  // Totals
  const totalTaxable = invoices.reduce((s: number, i: any) => s + i.taxableAmount, 0);
  const totalGST = invoices.reduce((s: number, i: any) => s + i.igstAmount + i.cgstAmount + i.sgstAmount, 0);
  const grandTotal = invoices.reduce((s: number, i: any) => s + i.totalAmount, 0);

  // B2B / B2C split
  const b2b = invoices.filter((i: any) => i.buyerGstin);
  const b2c = invoices.filter((i: any) => !i.buyerGstin);

  // Save report history entry via fetcher (fire-and-forget)
  const saveHistory = useCallback((reportType: string, filename: string) => {
    const fd = new FormData();
    fd.append("intent", "save-report-history");
    fd.append("reportType", reportType);
    fd.append("dateFrom", from);
    fd.append("dateTo", to);
    fd.append("fileName", filename);
    fd.append("fileUrl", "");
    historyFetcher.submit(fd, { method: "post" });
  }, [from, to, historyFetcher]);

  // Client-side CSV download — uses already-loaded data, no server round-trip needed
  // (avoids Shopify auth issue when opening new tabs)
  const downloadCSV = useCallback((type: string) => {
    let csv = "";
    let filename = "";
    let reportType = "";
    if (type === "b2b") {
      csv = buildB2BCSV(b2b, shopGstin);
      filename = `gstr1-b2b-${from}-to-${to}.csv`;
      reportType = "B2B-CSV";
    } else if (type === "b2c") {
      csv = buildB2CCSV(b2c);
      filename = `gstr1-b2c-${from}-to-${to}.csv`;
      reportType = "B2C-CSV";
    } else if (type === "hsn") {
      csv = buildHSNCSV(buildHSNMap(invoices as any[]));
      filename = `hsn-summary-${from}-to-${to}.csv`;
      reportType = "HSN-CSV";
    } else if (type === "gstr3b") {
      csv = buildGSTR3BCSV(buildGSTR3BSummary(invoices as any[], shopState));
      filename = `gstr3b-${from}-to-${to}.csv`;
      reportType = "GSTR-3B-CSV";
    }
    // BOM prefix so Excel opens UTF-8 correctly
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Persist to report history
    if (reportType) saveHistory(reportType, filename);
  }, [from, to, b2b, b2c, invoices, shopGstin, shopState, saveHistory]);

  const downloadTallyXML = useCallback(() => {
    const xml = buildTallyXML(invoices as any[], shopName);
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tally-sales-${from}-to-${to}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    saveHistory("TALLY-XML", `tally-sales-${from}-to-${to}.xml`);
  }, [invoices, shopName, from, to, saveHistory]);

  // HSN map
  const hsnMap = buildHSNMap(invoices);

  // GSTR-3B
  const gstr3b = buildGSTR3BSummary(invoices as any[], shopState);

  return (
    <Page title="GST Reports">
      <TitleBar title="GST Reports" />
      <BlockStack gap="500">

        {/* Date Range Filter */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm">Select Period</Text>
            <InlineStack gap="300" blockAlign="end" wrap>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div>
                  <Text as="p" variant="bodySm">From</Text>
                  <input
                    type="date"
                    value={fromVal}
                    onChange={(e) => setFromVal(e.target.value)}
                    style={{ border: "1px solid #ccc", borderRadius: 4, padding: "6px 10px", fontSize: 14 }}
                  />
                </div>
                <div>
                  <Text as="p" variant="bodySm">To</Text>
                  <input
                    type="date"
                    value={toVal}
                    onChange={(e) => setToVal(e.target.value)}
                    style={{ border: "1px solid #ccc", borderRadius: 4, padding: "6px 10px", fontSize: 14 }}
                  />
                </div>
                <div style={{ paddingTop: 18 }}>
                  <Button variant="primary" onClick={handleGenerate}>Generate</Button>
                </div>
              </div>
              <InlineStack gap="200" wrap>
                <Button size="slim" onClick={() => setQuickRange(monthRange(0))}>This Month</Button>
                <Button size="slim" onClick={() => setQuickRange(monthRange(-1))}>Last Month</Button>
                <Button size="slim" onClick={() => setQuickRange(quarterRange(0))}>This Quarter</Button>
                <Button size="slim" onClick={() => setQuickRange(quarterRange(-1))}>Last Quarter</Button>
              </InlineStack>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Period: {fmtDate(from)} – {fmtDate(to)}
              {shopGstin && ` · GSTIN: ${shopGstin}`}
            </Text>
          </BlockStack>
        </Card>

        {/* Summary Cards — hide on History tab */}
        {selectedTab !== 4 && (
          <InlineStack gap="400" wrap>
            {[
              { label: "Total Invoices", value: String(invoices.length) },
              { label: "Taxable Value", value: fmt(totalTaxable) },
              { label: "Total GST", value: fmt(totalGST) },
              { label: "Grand Total", value: fmt(grandTotal) },
            ].map((card) => (
              <div key={card.label} style={{ flex: "1 1 180px", minWidth: 160 }}>
                <Card>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{card.label}</Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">{card.value}</Text>
                  </BlockStack>
                </Card>
              </div>
            ))}
          </InlineStack>
        )}

        {/* Tally Export */}
        {selectedTab !== 4 && invoices.length > 0 && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingSm">Tally Export</Text>
                  {!canUseFeature(currentPlan, "tally-export") && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                      🔒 Pro
                    </span>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Tally XML mein import karo — {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}. Required ledgers in Tally:{" "}
                  <Text as="span" fontWeight="semibold">Sales Account</Text>,{" "}
                  <Text as="span" fontWeight="semibold">Output CGST</Text>,{" "}
                  <Text as="span" fontWeight="semibold">Output SGST</Text>,{" "}
                  <Text as="span" fontWeight="semibold">Output IGST</Text>.
                  Buyer name = party ledger name.
                </Text>
              </BlockStack>
              <Button
                onClick={canUseFeature(currentPlan, "tally-export") ? downloadTallyXML : () => navigate("/app/billing")}
              >
                {canUseFeature(currentPlan, "tally-export") ? "Download Tally XML" : "Upgrade to Download"}
              </Button>
            </InlineStack>
          </Card>
        )}

        {/* Main card with tabs */}
        {selectedTab === 4 ? (
          /* ── History Tab (standalone card, no invoice-empty-state guard) ── */
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
              <BlockStack gap="0">
                {reportHistory.length === 0 ? (
                  <EmptyState
                    heading="No report history yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <Text as="p" tone="subdued">
                      Reports you download will appear here. Download a CSV from any tab to get started.
                    </Text>
                  </EmptyState>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "report", plural: "reports" }}
                    itemCount={reportHistory.length}
                    headings={[
                      { title: "Report Type" },
                      { title: "Date Range" },
                      { title: "Generated At" },
                      { title: "Download" },
                    ]}
                    selectable={false}
                  >
                    {reportHistory.map((rec: any, idx: number) => (
                      <IndexTable.Row id={rec.id} key={rec.id} position={idx}>
                        <IndexTable.Cell>
                          <Badge>{REPORT_TYPE_LABELS[rec.reportType] ?? rec.reportType}</Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {fmtDate(rec.dateFrom)} – {fmtDate(rec.dateTo)}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {new Date(rec.createdAt).toLocaleString("en-IN", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {rec.fileUrl ? (
                            <Button
                              size="slim"
                              url={rec.fileUrl}
                              external
                            >
                              Download
                            </Button>
                          ) : (
                            <Text as="span" tone="subdued">—</Text>
                          )}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Tabs>
          </Card>
        ) : invoices.length === 0 ? (
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
              <EmptyState
                heading="No invoices found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" tone="subdued">No invoices found for the selected period. Try a different date range.</Text>
              </EmptyState>
            </Tabs>
          </Card>
        ) : (
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>

              {/* B2B Tab */}
              {selectedTab === 0 && (
                <BlockStack gap="0">
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                    {!canUseFeature(currentPlan, "gstr-reports") && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                        🔒 Pro
                      </span>
                    )}
                    <Button
                      size="slim"
                      onClick={canUseFeature(currentPlan, "gstr-reports") ? () => downloadCSV("b2b") : () => navigate("/app/billing")}
                    >
                      Download CSV (GSTR-1 B2B)
                    </Button>
                  </div>
                  {b2b.length === 0 ? (
                    <div style={{ padding: 24 }}>
                      <Text as="p" tone="subdued">No B2B invoices (no buyer GSTIN) in this period.</Text>
                    </div>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "invoice", plural: "invoices" }}
                      itemCount={b2b.length}
                      headings={[
                        { title: "Invoice No." }, { title: "Date" }, { title: "Buyer" },
                        { title: "Buyer GSTIN" }, { title: "Place of Supply" },
                        { title: "Taxable Value" }, { title: "IGST" }, { title: "CGST" },
                        { title: "SGST" }, { title: "Total" },
                      ]}
                      selectable={false}
                    >
                      {b2b.map((inv: any, idx: number) => (
                        <IndexTable.Row id={inv.id} key={inv.id} position={idx}>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{inv.invoiceNumber}</Text></IndexTable.Cell>
                          <IndexTable.Cell>{fmtDate(inv.invoiceDate)}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.buyerName || "—"}</IndexTable.Cell>
                          <IndexTable.Cell><Badge>{inv.buyerGstin}</Badge></IndexTable.Cell>
                          <IndexTable.Cell>{inv.placeOfSupply || "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(inv.taxableAmount)}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.igstAmount > 0 ? fmt(inv.igstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.cgstAmount > 0 ? fmt(inv.cgstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.sgstAmount > 0 ? fmt(inv.sgstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{fmt(inv.totalAmount)}</Text></IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                      <IndexTable.Row id="b2b-total" key="b2b-total" position={b2b.length}>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">TOTAL</Text></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2b.reduce((s: number, i: any) => s + i.taxableAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2b.reduce((s: number, i: any) => s + i.igstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2b.reduce((s: number, i: any) => s + i.cgstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2b.reduce((s: number, i: any) => s + i.sgstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2b.reduce((s: number, i: any) => s + i.totalAmount, 0))}</Text></IndexTable.Cell>
                      </IndexTable.Row>
                    </IndexTable>
                  )}
                </BlockStack>
              )}

              {/* B2C Tab */}
              {selectedTab === 1 && (
                <BlockStack gap="0">
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                    {!canUseFeature(currentPlan, "gstr-reports") && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                        🔒 Pro
                      </span>
                    )}
                    <Button
                      size="slim"
                      onClick={canUseFeature(currentPlan, "gstr-reports") ? () => downloadCSV("b2c") : () => navigate("/app/billing")}
                    >
                      Download CSV (GSTR-1 B2C)
                    </Button>
                  </div>
                  {b2c.length === 0 ? (
                    <div style={{ padding: 24 }}>
                      <Text as="p" tone="subdued">No B2C invoices in this period.</Text>
                    </div>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "invoice", plural: "invoices" }}
                      itemCount={b2c.length}
                      headings={[
                        { title: "Invoice No." }, { title: "Date" }, { title: "Buyer" },
                        { title: "State" }, { title: "Taxable Value" },
                        { title: "IGST" }, { title: "CGST" }, { title: "SGST" }, { title: "Total" },
                      ]}
                      selectable={false}
                    >
                      {b2c.map((inv: any, idx: number) => (
                        <IndexTable.Row id={inv.id} key={inv.id} position={idx}>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{inv.invoiceNumber}</Text></IndexTable.Cell>
                          <IndexTable.Cell>{fmtDate(inv.invoiceDate)}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.buyerName || "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.buyerState || "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(inv.taxableAmount)}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.igstAmount > 0 ? fmt(inv.igstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.cgstAmount > 0 ? fmt(inv.cgstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{inv.sgstAmount > 0 ? fmt(inv.sgstAmount) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{fmt(inv.totalAmount)}</Text></IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                      <IndexTable.Row id="b2c-total" key="b2c-total" position={b2c.length}>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">TOTAL</Text></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2c.reduce((s: number, i: any) => s + i.taxableAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2c.reduce((s: number, i: any) => s + i.igstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2c.reduce((s: number, i: any) => s + i.cgstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2c.reduce((s: number, i: any) => s + i.sgstAmount, 0))}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(b2c.reduce((s: number, i: any) => s + i.totalAmount, 0))}</Text></IndexTable.Cell>
                      </IndexTable.Row>
                    </IndexTable>
                  )}
                </BlockStack>
              )}

              {/* HSN Summary Tab */}
              {selectedTab === 2 && (
                <BlockStack gap="0">
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                    {!canUseFeature(currentPlan, "gstr-reports") && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                        🔒 Pro
                      </span>
                    )}
                    <Button
                      size="slim"
                      onClick={canUseFeature(currentPlan, "gstr-reports") ? () => downloadCSV("hsn") : () => navigate("/app/billing")}
                    >
                      Download CSV (HSN Summary)
                    </Button>
                  </div>
                  {hsnMap.size === 0 ? (
                    <div style={{ padding: 24 }}>
                      <Text as="p" tone="subdued">No line item data found for this period.</Text>
                    </div>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "HSN entry", plural: "HSN entries" }}
                      itemCount={hsnMap.size}
                      headings={[
                        { title: "HSN Code" }, { title: "Description" }, { title: "UQC" },
                        { title: "Qty" }, { title: "Taxable Value" },
                        { title: "IGST" }, { title: "CGST" }, { title: "SGST" }, { title: "Total Tax" },
                      ]}
                      selectable={false}
                    >
                      {Array.from(hsnMap.entries()).map(([hsn, d], idx) => (
                        <IndexTable.Row id={hsn} key={hsn} position={idx}>
                          <IndexTable.Cell>
                            <Badge tone={hsn === "N/A" ? "attention" : "success"}>{hsn}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{d.name}</IndexTable.Cell>
                          <IndexTable.Cell>NOS</IndexTable.Cell>
                          <IndexTable.Cell>{r2(d.qty)}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(d.taxableValue)}</IndexTable.Cell>
                          <IndexTable.Cell>{d.igst > 0 ? fmt(d.igst) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{d.cgst > 0 ? fmt(d.cgst) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{d.sgst > 0 ? fmt(d.sgst) : "—"}</IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{fmt(d.igst + d.cgst + d.sgst)}</Text></IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </BlockStack>
              )}

              {/* GSTR-3B Tab */}
              {selectedTab === 3 && (
                <BlockStack gap="0">
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                    {!canUseFeature(currentPlan, "gstr-reports") && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10, border: "1px solid #FDE68A" }}>
                        🔒 Pro
                      </span>
                    )}
                    <Button
                      size="slim"
                      onClick={canUseFeature(currentPlan, "gstr-reports") ? () => downloadCSV("gstr3b") : () => navigate("/app/billing")}
                    >
                      Download CSV (GSTR-3B)
                    </Button>
                  </div>
                  <div style={{ padding: "0 16px 16px" }}>
                    <BlockStack gap="300">
                      <Banner tone="info">
                        GSTR-3B is a monthly self-declaration return. Verify amounts before filing.
                      </Banner>
                      <IndexTable
                        resourceName={{ singular: "row", plural: "rows" }}
                        itemCount={4}
                        headings={[
                          { title: "Nature of Supplies" }, { title: "Total Taxable Value" },
                          { title: "Integrated Tax (IGST)" }, { title: "Central Tax (CGST)" },
                          { title: "State/UT Tax (SGST)" },
                        ]}
                        selectable={false}
                      >
                        <IndexTable.Row id="row-1" position={0}>
                          <IndexTable.Cell>Outward Taxable Supplies</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(gstr3b.taxableValue)}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(gstr3b.igst)}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(gstr3b.cgst)}</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(gstr3b.sgst)}</IndexTable.Cell>
                        </IndexTable.Row>
                        <IndexTable.Row id="row-2" position={1}>
                          <IndexTable.Cell>Zero Rated Supplies / Exports</IndexTable.Cell>
                          <IndexTable.Cell>{fmt(gstr3b.exportValue)}</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                        </IndexTable.Row>
                        <IndexTable.Row id="row-3" position={2}>
                          <IndexTable.Cell>Nil Rated / Exempt Supplies</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                          <IndexTable.Cell>—</IndexTable.Cell>
                        </IndexTable.Row>
                        <IndexTable.Row id="row-total" position={3}>
                          <IndexTable.Cell><Text as="span" fontWeight="bold">TOTAL</Text></IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(gstr3b.taxableValue + gstr3b.exportValue)}</Text></IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(gstr3b.igst)}</Text></IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(gstr3b.cgst)}</Text></IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" fontWeight="bold">{fmt(gstr3b.sgst)}</Text></IndexTable.Cell>
                        </IndexTable.Row>
                      </IndexTable>
                    </BlockStack>
                  </div>
                </BlockStack>
              )}

            </Tabs>
          </Card>
        )}

      </BlockStack>
    </Page>
  );
}
