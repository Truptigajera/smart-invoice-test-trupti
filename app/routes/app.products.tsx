import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button,
  IndexTable, Badge, Tabs, Thumbnail, InlineStack,
  Banner, Modal, FormLayout, Select, EmptyState, Toast, Frame, Pagination, Box,
  useIndexResourceState, Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "~/shopify.server";
import { VALID_GST_RATES, isValidGstRate, isValidHsnCode } from "~/lib/gst";

const METAFIELD_NAMESPACE = "gst_invoice";
const HSN_KEY = "hsn_code";
const GST_RATE_KEY = "gst_rate";
const PAGE_SIZE = 25;
// Whole-store scan for stats / "Missing HSN" / HSN summary. ~35 query cost per 250 products,
// so this stays fast; very large catalogues are capped and reported as "N+".
const SCAN_PAGE = 250;
const SCAN_LIMIT = 2500;
// metafieldsSet accepts at most 25 metafields per call
const METAFIELDS_PER_CALL = 25;

type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED" | string;
type Product = {
  id: string;
  numericId: string;
  title: string;
  status: ProductStatus;
  image: string | null;
  hsnCode: string;
  gstRate: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<any> };

const PRODUCT_FIELDS = `
  id
  title
  status
  featuredMedia { preview { image { url } } }
  hsn: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${HSN_KEY}") { value }
  gst: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${GST_RATE_KEY}") { value }
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProduct(node: any): Product {
  return {
    id: node.id,
    numericId: node.id.split("/").pop(),
    title: node.title,
    status: node.status,
    image: node.featuredMedia?.preview?.image?.url || null,
    hsnCode: node.hsn?.value || "",
    gstRate: node.gst?.value || "",
  };
}

const needsAttention = (p: Product) => !p.hsnCode || !p.gstRate || !isValidGstRate(p.gstRate);

// Reads every product (up to SCAN_LIMIT) with its HSN / GST metafields
async function scanProducts(admin: Admin, search: string) {
  const products: Product[] = [];
  let after: string | null = null;
  let truncated = false;
  do {
    const res = await admin.graphql(
      `query ScanProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${PRODUCT_FIELDS} } }
        }
      }`,
      { variables: { first: SCAN_PAGE, after, query: search ? `title:*${search}*` : null } }
    );
    const data = (await res.json()).data?.products;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of data?.edges ?? []) products.push(toProduct((e as any).node));
    after = data?.pageInfo?.hasNextPage ? data.pageInfo.endCursor : null;
    if (after && products.length >= SCAN_LIMIT) { truncated = true; after = null; }
  } while (after);
  return { products, truncated };
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "all";
  const search = (url.searchParams.get("search") || "").trim();
  const cursor = url.searchParams.get("cursor") || null;
  const dir = url.searchParams.get("dir") === "prev" ? "prev" : "next";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  // Whole-store scan: tab counts, "Missing HSN" list and HSN summary all need every product
  const scanPromise = scanProducts(admin as Admin, search);

  let products: Product[] = [];
  let pageInfo = { hasNextPage: false, hasPreviousPage: false, endCursor: null as string | null, startCursor: null as string | null };

  if (tab === "all" || tab === "recent") {
    // Cursor pagination straight from Shopify. "prev" must walk backwards (last/before) —
    // using the start cursor with `after` just showed the same page again.
    const variables: Record<string, unknown> = {
      query: search ? `title:*${search}*` : null,
      sortKey: tab === "recent" ? "CREATED_AT" : "TITLE",
      reverse: tab === "recent",
    };
    if (cursor && dir === "prev") { variables.last = PAGE_SIZE; variables.before = cursor; }
    else { variables.first = PAGE_SIZE; if (cursor) variables.after = cursor; }

    const res = await admin.graphql(
      `query ListProducts($first: Int, $last: Int, $after: String, $before: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
        products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
          pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
          edges { node { ${PRODUCT_FIELDS} } }
        }
      }`,
      { variables }
    );
    const data = (await res.json()).data?.products;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products = (data?.edges ?? []).map((e: any) => toProduct(e.node));
    pageInfo = data?.pageInfo ?? pageInfo;
  }

  const scan = await scanPromise;
  const attention = scan.products.filter(needsAttention);
  const stats = {
    scanned: scan.products.length,
    truncated: scan.truncated,
    missingHsn: scan.products.filter((p) => !p.hsnCode).length,
    missingRate: scan.products.filter((p) => !p.gstRate).length,
    invalidRate: scan.products.filter((p) => p.gstRate && !isValidGstRate(p.gstRate)).length,
    needsAttention: attention.length,
  };

  // "Missing HSN" tab: products from the whole-store scan, paged locally
  let attentionPage = { totalPages: 1 };
  if (tab === "missing") {
    products = attention.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    attentionPage = { totalPages: Math.max(1, Math.ceil(attention.length / PAGE_SIZE)) };
  }

  // "HSN summary" tab: each HSN code with its GST rate(s) and how many products use it
  // (the same grouping GSTR-1's HSN-wise summary needs)
  let hsnSummary: Array<{ hsn: string; rates: string[]; count: number; examples: string[] }> = [];
  if (tab === "hsn-list") {
    const groups = new Map<string, { rates: Set<string>; count: number; examples: string[] }>();
    for (const p of scan.products) {
      if (!p.hsnCode) continue;
      const g = groups.get(p.hsnCode) ?? { rates: new Set<string>(), count: 0, examples: [] };
      if (p.gstRate) g.rates.add(p.gstRate);
      g.count++;
      if (g.examples.length < 3) g.examples.push(p.title);
      groups.set(p.hsnCode, g);
    }
    hsnSummary = Array.from(groups, ([hsn, g]) => ({ hsn, rates: Array.from(g.rates), count: g.count, examples: g.examples }))
      .sort((a, b) => b.count - a.count);
  }

  return json({ products, pageInfo, tab, search, page, attentionPage, stats, hsnSummary });
};

// ─── Action ──────────────────────────────────────────────────────────────────

const SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;
const DELETE_MUTATION = `
  mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { userErrors { field message } }
  }
`;

const toGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`);
const mf = (ownerId: string, key: string, value: string) =>
  ({ ownerId, namespace: METAFIELD_NAMESPACE, key, value, type: "single_line_text_field" });

// Sends metafields in batches of 25; returns the Shopify error messages, if any
async function setMetafields(admin: Admin, metafields: ReturnType<typeof mf>[]): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < metafields.length; i += METAFIELDS_PER_CALL) {
    const res = await admin.graphql(SET_MUTATION, { variables: { metafields: metafields.slice(i, i + METAFIELDS_PER_CALL) } });
    const userErrors = (await res.json()).data?.metafieldsSet?.userErrors ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errors.push(...userErrors.map((e: any) => e.message));
  }
  return errors;
}

function validate(hsnCode: string, gstRate: string): string | null {
  if (hsnCode && !isValidHsnCode(hsnCode)) return `HSN code "${hsnCode}" must be 4, 6 or 8 digits.`;
  if (gstRate && !isValidGstRate(gstRate)) return `GST rate "${gstRate}" is not a valid GST rate (${VALID_GST_RATES.join(", ")}%).`;
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // ── Single product: set, change or remove HSN / GST ──────────────────────
  if (intent === "save-hsn") {
    const productId = formData.get("productId") as string;
    const hsnCode = ((formData.get("hsnCode") as string) || "").trim();
    const gstRate = ((formData.get("gstRate") as string) || "").trim();
    const error = validate(hsnCode, gstRate);
    if (error) return json({ error });

    // Empty field = remove it (previously an emptied field was silently ignored,
    // so a wrong HSN code could never be cleared)
    const toSet = [
      ...(hsnCode ? [mf(productId, HSN_KEY, hsnCode)] : []),
      ...(gstRate ? [mf(productId, GST_RATE_KEY, gstRate)] : []),
    ];
    const toDelete = [
      ...(!hsnCode ? [{ ownerId: productId, namespace: METAFIELD_NAMESPACE, key: HSN_KEY }] : []),
      ...(!gstRate ? [{ ownerId: productId, namespace: METAFIELD_NAMESPACE, key: GST_RATE_KEY }] : []),
    ];
    const errors = toSet.length ? await setMetafields(admin as Admin, toSet) : [];
    if (toDelete.length) {
      const res = await admin.graphql(DELETE_MUTATION, { variables: { metafields: toDelete } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errors.push(...((await res.json()).data?.metafieldsDelete?.userErrors ?? []).map((e: any) => e.message));
    }
    if (errors.length) return json({ error: errors[0] });
    return json({ success: true, message: "Saved" });
  }

  // ── Bulk edit: same HSN and/or GST rate for every selected product ─────────
  if (intent === "bulk-set") {
    const productIds: string[] = JSON.parse((formData.get("productIds") as string) || "[]");
    const hsnCode = ((formData.get("hsnCode") as string) || "").trim();
    const gstRate = ((formData.get("gstRate") as string) || "").trim();
    if (!productIds.length) return json({ error: "No products selected." });
    if (!hsnCode && !gstRate) return json({ error: "Enter an HSN code or choose a GST rate." });
    const error = validate(hsnCode, gstRate);
    if (error) return json({ error });

    const metafields = productIds.flatMap((id) => [
      ...(hsnCode ? [mf(toGid(id), HSN_KEY, hsnCode)] : []),
      ...(gstRate ? [mf(toGid(id), GST_RATE_KEY, gstRate)] : []),
    ]);
    const errors = await setMetafields(admin as Admin, metafields);
    if (errors.length) return json({ error: errors[0] });
    return json({ success: true, message: `Updated ${productIds.length} product(s)` });
  }

  // ── CSV import ─────────────────────────────────────────────────────────────
  if (intent === "bulk-save-hsn") {
    let rows: Array<{ line: number; productId: string; hsnCode: string; gstRate: string }> = [];
    try {
      rows = JSON.parse(formData.get("rows") as string);
    } catch {
      return json({ error: "Invalid CSV data" });
    }

    // Validate every row first; bad rows are reported, good rows are still saved
    const skipped: string[] = [];
    const metafields: ReturnType<typeof mf>[] = [];
    let products = 0;
    for (const row of rows) {
      if (!row.productId) continue;
      const hsn = row.hsnCode.trim();
      const rate = row.gstRate.replace("%", "").trim();
      const error = validate(hsn, rate);
      if (error) { skipped.push(`Row ${row.line}: ${error}`); continue; }
      if (!hsn && !rate) continue;
      const gid = toGid(row.productId);
      if (hsn) metafields.push(mf(gid, HSN_KEY, hsn));
      if (rate) metafields.push(mf(gid, GST_RATE_KEY, rate));
      products++;
    }
    const errors = await setMetafields(admin as Admin, metafields);
    return json({
      success: true,
      message: `Updated ${products} product(s)${skipped.length ? ` · ${skipped.length} row(s) skipped` : ""}`,
      skipped: [...skipped, ...errors].slice(0, 20),
    });
  }

  // ── CSV export: every product, not just the page on screen ─────────────────
  if (intent === "export-csv") {
    const { products } = await scanProducts(admin as Admin, "");
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = "﻿" + ["Product ID,Product Title,Status,HSN Code,GST Rate",
      ...products.map((p) => [p.numericId, p.title, p.status, p.hsnCode, p.gstRate].map(esc).join(",")),
    ].join("\n");
    return json({ csv });
  }

  return json({ error: "Unknown action" });
};

// ─── CSV parsing ─────────────────────────────────────────────────────────────

// RFC 4180 parser: handles quoted fields with commas/quotes/newlines. The old split(",")
// shifted every column when a product title contained a comma ("Shirt, Blue").
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ─── Component ───────────────────────────────────────────────────────────────

const RATE_OPTIONS = [
  { label: "Select GST rate", value: "" },
  ...VALID_GST_RATES.map((r) => ({ label: `${r}%`, value: r })),
];

function HsnBadge({ code }: { code: string }) {
  if (!code) return <Badge tone="attention">Missing</Badge>;
  return <Badge tone="success">{code}</Badge>;
}

function GstBadge({ rate }: { rate: string }) {
  if (!rate) return <Badge tone="attention">Missing</Badge>;
  if (!isValidGstRate(rate)) return <Badge tone="critical">{`${rate}% · invalid`}</Badge>;
  return <Badge>{`${rate}%`}</Badge>;
}

function EditHsnModal({ product, onClose }: { product: Product | null; onClose: (saved: boolean) => void }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [hsn, setHsn] = useState(product?.hsnCode ?? "");
  // An invalid stored rate (e.g. "6") isn't offered — the merchant must pick a real one
  const [gst, setGst] = useState(product && isValidGstRate(product.gstRate) ? product.gstRate : "");

  useEffect(() => {
    if (fetcher.data?.success) onClose(true);
  }, [fetcher.data, onClose]);

  const saving = fetcher.state !== "idle";
  const hsnError = hsn && !isValidHsnCode(hsn) ? "HSN code must be 4, 6 or 8 digits" : undefined;

  return (
    <Modal
      open={!!product}
      onClose={() => onClose(false)}
      title={`Edit HSN & GST — ${product?.title}`}
      primaryAction={{
        content: saving ? "Saving..." : "Save",
        disabled: saving || !!hsnError,
        onAction: () => {
          if (!product) return;
          fetcher.submit({ intent: "save-hsn", productId: product.id, hsnCode: hsn, gstRate: gst }, { method: "post" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: () => onClose(false) }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          {product?.gstRate && !isValidGstRate(product.gstRate) && (
            <Banner tone="warning">
              The saved GST rate "{product.gstRate}%" is not a valid GST rate, so invoices ignore it. Please choose the correct rate.
            </Banner>
          )}
          <FormLayout>
            <TextField
              label="HSN / SAC Code"
              value={hsn}
              onChange={(v) => setHsn(v.replace(/\D/g, "").slice(0, 8))}
              placeholder="e.g. 6109"
              helpText="4, 6 or 8 digits. Leave empty to remove."
              error={hsnError}
              autoComplete="off"
            />
            <Select label="GST Rate" options={RATE_OPTIONS} value={gst} onChange={setGst} helpText="Choose “Select GST rate” to remove." />
          </FormLayout>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function BulkEditModal({ productIds, onClose }: { productIds: string[]; onClose: (saved: boolean) => void }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const [hsn, setHsn] = useState("");
  const [gst, setGst] = useState("");

  useEffect(() => {
    if (fetcher.data?.success) onClose(true);
  }, [fetcher.data, onClose]);

  const saving = fetcher.state !== "idle";
  const hsnError = hsn && !isValidHsnCode(hsn) ? "HSN code must be 4, 6 or 8 digits" : undefined;

  return (
    <Modal
      open={productIds.length > 0}
      onClose={() => onClose(false)}
      title={`Set HSN & GST for ${productIds.length} product(s)`}
      primaryAction={{
        content: saving ? "Saving..." : "Apply to selected",
        disabled: saving || !!hsnError || (!hsn && !gst),
        onAction: () =>
          fetcher.submit(
            { intent: "bulk-set", productIds: JSON.stringify(productIds), hsnCode: hsn, gstRate: gst },
            { method: "post" }
          ),
      }}
      secondaryActions={[{ content: "Cancel", onAction: () => onClose(false) }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          <FormLayout>
            <TextField
              label="HSN / SAC Code"
              value={hsn}
              onChange={(v) => setHsn(v.replace(/\D/g, "").slice(0, 8))}
              placeholder="e.g. 6109"
              helpText="Leave empty to keep each product's current HSN code."
              error={hsnError}
              autoComplete="off"
            />
            <Select label="GST Rate" options={RATE_OPTIONS} value={gst} onChange={setGst} helpText="Leave unselected to keep each product's current rate." />
          </FormLayout>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

const TABS = [
  { id: "all", content: "All Products" },
  { id: "missing", content: "Needs attention" },
  { id: "recent", content: "Recently Added" },
  { id: "hsn-list", content: "HSN Summary" },
];

export default function ProductsPage() {
  const { products, pageInfo, tab, search, page, attentionPage, stats, hsnSummary } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  const selectedTab = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const importFetcher = useFetcher<{ success?: boolean; message?: string; error?: string; skipped?: string[] }>();
  const exportFetcher = useFetcher<{ csv?: string; error?: string }>();

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(products.map((p: Product) => ({ id: p.id })));

  const setParams = useCallback((updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  const handleTabChange = (idx: number) => {
    clearSelection();
    setParams({ tab: TABS[idx].id, cursor: null, dir: null, page: null });
  };

  // Search: wait until typing stops instead of reloading on every keystroke
  const [searchValue, setSearchValue] = useState(search);
  useEffect(() => setSearchValue(search), [search]);
  useEffect(() => {
    if (searchValue.trim() === search) return;
    const t = setTimeout(() => setParams({ search: searchValue.trim() || null, cursor: null, dir: null, page: null }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  // CSV export (every product, built on the server)
  useEffect(() => {
    const csv = exportFetcher.data?.csv;
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href; a.download = "hsn-codes.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(href);
  }, [exportFetcher.data]);

  // CSV import — columns are found by header name, so files from the old and new export both work
  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const table = parseCsv(String(ev.target?.result || "").replace(/^﻿/, ""));
      const header = (table[0] || []).map((h) => h.trim().toLowerCase());
      const col = (name: string, fallback: number) => (header.indexOf(name) >= 0 ? header.indexOf(name) : fallback);
      const iId = col("product id", 0), iHsn = col("hsn code", 2), iGst = col("gst rate", 3);
      const rows = table.slice(1).map((r, i) => ({
        line: i + 2,
        productId: (r[iId] || "").trim(),
        hsnCode: (r[iHsn] || "").trim(),
        gstRate: (r[iGst] || "").trim(),
      })).filter((r) => r.productId);
      if (rows.length) importFetcher.submit({ intent: "bulk-save-hsn", rows: JSON.stringify(rows) }, { method: "POST" });
      else setToast({ msg: "No product rows found in the CSV", error: true });
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [importFetcher]);

  useEffect(() => {
    const d = importFetcher.data;
    if (!d) return;
    if (d.success) {
      setToast({ msg: d.message || "Import complete", error: !!d.skipped?.length });
      setImportIssues(d.skipped || []);
      revalidator.revalidate();
    } else if (d.error) setToast({ msg: d.error, error: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importFetcher.data]);

  const closeEdit = useCallback((saved: boolean) => {
    setEditProduct(null);
    if (saved) { setToast({ msg: "HSN & GST saved" }); revalidator.revalidate(); }
  }, [revalidator]);

  const closeBulk = useCallback((saved: boolean) => {
    setBulkIds((ids) => {
      if (saved) setToast({ msg: `Updated ${ids.length} product(s)` });
      return [];
    });
    if (saved) { clearSelection(); revalidator.revalidate(); }
  }, [revalidator, clearSelection]);

  const count = (n: number) => `${n}${stats.truncated ? "+" : ""}`;
  const tabs = TABS.map((t) => (t.id === "missing" && stats.needsAttention ? { ...t, content: `${t.content} (${count(stats.needsAttention)})` } : t));

  const rowMarkup = products.map((product: Product, idx: number) => (
    <IndexTable.Row id={product.id} key={product.id} position={idx} selected={selectedResources.includes(product.id)}>
      <IndexTable.Cell>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          {product.image ? (
            <Thumbnail source={product.image} alt={product.title} size="extraSmall" />
          ) : (
            <div style={{ width: 24, height: 24, background: "#f4f6f8", borderRadius: 4 }} />
          )}
          <Text as="span" variant="bodySm" fontWeight="medium">{product.title}</Text>
          {/* Most products are active — only call out the others */}
          {product.status !== "ACTIVE" && (
            <Badge tone="attention">{product.status === "ARCHIVED" ? "Archived" : "Draft"}</Badge>
          )}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell><HsnBadge code={product.hsnCode} /></IndexTable.Cell>
      <IndexTable.Cell><GstBadge rate={product.gstRate} /></IndexTable.Cell>
      <IndexTable.Cell>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="slim" onClick={() => setEditProduct(product)}>Edit</Button>
        </span>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const isListTab = tab !== "hsn-list";
  const showPager = tab === "missing"
    ? attentionPage.totalPages > 1
    : isListTab && (pageInfo.hasNextPage || pageInfo.hasPreviousPage);

  return (
    <Frame>
      {toast && <Toast content={toast.msg} error={toast.error} onDismiss={() => setToast(null)} />}
      <input ref={csvInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSVUpload} />
      <Page
        title="Products & HSN"
        fullWidth
        secondaryActions={[
          { content: exportFetcher.state !== "idle" ? "Preparing CSV…" : "Download CSV", onAction: () => exportFetcher.submit({ intent: "export-csv" }, { method: "POST" }), disabled: exportFetcher.state !== "idle" },
          { content: importFetcher.state !== "idle" ? "Importing…" : "Import CSV", onAction: () => csvInputRef.current?.click(), disabled: importFetcher.state !== "idle" },
        ]}
      >
        <TitleBar title="Products & HSN" />
        <BlockStack gap="400">

          {/* Store-wide status — the reason this page exists */}
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingXs">HSN & GST status</Text>
                <Text as="span" variant="bodySm" tone="subdued">{count(stats.scanned)} product(s)</Text>
              </InlineStack>
              <Divider />
              <InlineStack gap="600" wrap>
                {[
                  { label: "Missing HSN code", value: stats.missingHsn, tone: stats.missingHsn ? "caution" : "success" },
                  { label: "Missing GST rate", value: stats.missingRate, tone: stats.missingRate ? "caution" : "success" },
                  { label: "Invalid GST rate", value: stats.invalidRate, tone: stats.invalidRate ? "critical" : "success" },
                ].map((s) => (
                  <BlockStack key={s.label} gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                    <Text as="span" variant="bodySm" fontWeight="bold" tone={s.tone as "caution" | "success" | "critical"}>
                      {count(s.value)}
                    </Text>
                  </BlockStack>
                ))}
                {stats.needsAttention > 0 && tab !== "missing" && (
                  <Button size="slim" onClick={() => handleTabChange(1)}>Fix them →</Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>

          {importFetcher.state !== "idle" && <Banner tone="info">Updating HSN codes, please wait…</Banner>}
          {importIssues.length > 0 && (
            <Banner tone="warning" title="Some CSV rows were not imported" onDismiss={() => setImportIssues([])}>
              <BlockStack gap="050">
                {importIssues.map((i) => <Text key={i} as="p" variant="bodySm">{i}</Text>)}
              </BlockStack>
            </Banner>
          )}

          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} fitted>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #e1e3e5" }}>
                <TextField
                  label="" labelHidden
                  placeholder="Search products..."
                  value={searchValue}
                  onChange={setSearchValue}
                  clearButton
                  onClearButtonClick={() => setSearchValue("")}
                  autoComplete="off"
                />
              </div>

              {tab === "hsn-list" ? (
                hsnSummary.length === 0 ? (
                  <EmptyState heading="No HSN codes yet" image="">
                    <Text as="p" variant="bodySm" tone="subdued">Assign HSN codes to products and they will be summarised here.</Text>
                  </EmptyState>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "HSN code", plural: "HSN codes" }}
                    itemCount={hsnSummary.length}
                    selectable={false}
                    headings={[{ title: "HSN Code" }, { title: "GST Rate" }, { title: "Products" }, { title: "Examples" }]}
                  >
                    {hsnSummary.map((h, i) => (
                      <IndexTable.Row id={h.hsn} key={h.hsn} position={i}>
                        <IndexTable.Cell><Text as="span" variant="bodySm" fontWeight="semibold">{h.hsn}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="100">
                            {h.rates.length ? h.rates.map((r) => <GstBadge key={r} rate={r} />) : <GstBadge rate="" />}
                            {/* One HSN code should normally carry one GST rate */}
                            {h.rates.length > 1 && <Badge tone="warning">Different rates</Badge>}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm">{h.count}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm" tone="subdued">{h.examples.join(", ")}{h.count > h.examples.length ? "…" : ""}</Text></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )
              ) : products.length === 0 ? (
                <EmptyState heading={tab === "missing" && !search ? "All products have HSN & GST!" : "No products found"} image="">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {tab === "missing" && !search ? "Every product has a valid HSN code and GST rate." : "Try adjusting your search."}
                  </Text>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={products.length}
                  selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                  onSelectionChange={handleSelectionChange}
                  promotedBulkActions={[{ content: "Set HSN & GST", onAction: () => setBulkIds(selectedResources) }]}
                  headings={[{ title: "Product" }, { title: "HSN Code" }, { title: "GST Rate" }, { title: "Action" }]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Tabs>
          </Card>

          {showPager && (
            <div style={{
              position: "sticky", bottom: 0,
              background: "var(--p-color-bg-surface)",
              borderTop: "1px solid var(--p-color-border)",
              zIndex: 2,
            }}>
              <Box paddingBlock="300" paddingInline="400">
                <InlineStack align="center" gap="200" blockAlign="center">
                  {tab === "missing" ? (
                    <>
                      <Pagination
                        hasPrevious={page > 1}
                        onPrevious={() => { clearSelection(); setParams({ page: String(page - 1) }); }}
                        hasNext={page < attentionPage.totalPages}
                        onNext={() => { clearSelection(); setParams({ page: String(page + 1) }); }}
                      />
                      <Text as="span" variant="bodySm" tone="subdued">Page {page} of {attentionPage.totalPages}</Text>
                    </>
                  ) : (
                    <Pagination
                      hasPrevious={pageInfo.hasPreviousPage}
                      onPrevious={() => { clearSelection(); setParams({ cursor: pageInfo.startCursor, dir: "prev" }); }}
                      hasNext={pageInfo.hasNextPage}
                      onNext={() => { clearSelection(); setParams({ cursor: pageInfo.endCursor, dir: null }); }}
                    />
                  )}
                </InlineStack>
              </Box>
            </div>
          )}

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingXs">About HSN codes</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Every product on a GST invoice needs an HSN code (SAC for services) and a GST rate. Businesses with
                turnover up to ₹5 crore must show at least 4 digits on B2B invoices; above ₹5 crore, 6 digits are
                required on all invoices. Codes set here are used automatically on every new invoice — use
                Invoices → Recalculate to update ones already created.
              </Text>
            </BlockStack>
          </Card>

        </BlockStack>

        {editProduct && <EditHsnModal key={editProduct.id} product={editProduct} onClose={closeEdit} />}
        {bulkIds.length > 0 && <BulkEditModal productIds={bulkIds} onClose={closeBulk} />}
      </Page>
    </Frame>
  );
}
