import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  IndexTable, Badge, Tabs, Thumbnail, InlineStack, Spinner,
  Banner, Modal, FormLayout, Select, EmptyState, Toast, Frame, Pagination, Box,
  useIndexResourceState, Filters, ChoiceList,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "~/shopify.server";

const GST_RATES = ["0", "5", "12", "18", "28"];
const METAFIELD_NAMESPACE = "gst_invoice";
const HSN_KEY = "hsn_code";
const GST_RATE_KEY = "gst_rate";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || null;
  const tab = url.searchParams.get("tab") || "all";
  const search = url.searchParams.get("search") || "";

  const query = `
    query GetProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges {
          cursor
          node {
            id
            title
            status
            totalInventory
            images(first: 1) { edges { node { url altText } } }
            metafields(namespace: "${METAFIELD_NAMESPACE}", first: 10) {
              edges {
                node {
                  id
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  let queryFilter = search ? `title:*${search}*` : "";
  const variables: { first: number; after?: string; query?: string } = { first: 25 };
  if (cursor) variables.after = cursor;
  if (queryFilter) variables.query = queryFilter;

  const response = await admin.graphql(query, { variables });
  const data = await response.json();
  const productsData = data.data?.products;

  const products = (productsData?.edges || []).map((edge: any) => {
    const metafields = edge.node.metafields?.edges || [];
    const hsnMeta = metafields.find((m: any) => m.node.key === HSN_KEY);
    const gstMeta = metafields.find((m: any) => m.node.key === GST_RATE_KEY);
    return {
      id: edge.node.id,
      numericId: edge.node.id.split("/").pop(),
      title: edge.node.title,
      status: edge.node.status,
      image: edge.node.images?.edges?.[0]?.node?.url || null,
      hsnCode: hsnMeta?.node?.value || "",
      gstRate: gstMeta?.node?.value || "",
    };
  });

  return json({
    products,
    pageInfo: productsData?.pageInfo || {},
    tab,
    search,
  });
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-hsn") {
    const productId = formData.get("productId") as string;
    const hsnCode = (formData.get("hsnCode") as string || "").trim();
    const gstRate = (formData.get("gstRate") as string || "").trim();

    const mutation = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value }
          userErrors { field message }
        }
      }
    `;

    const metafields = [];
    if (hsnCode) {
      metafields.push({
        ownerId: productId,
        namespace: METAFIELD_NAMESPACE,
        key: HSN_KEY,
        value: hsnCode,
        type: "single_line_text_field",
      });
    }
    if (gstRate) {
      metafields.push({
        ownerId: productId,
        namespace: METAFIELD_NAMESPACE,
        key: GST_RATE_KEY,
        value: gstRate,
        type: "single_line_text_field",
      });
    }

    if (metafields.length === 0) {
      return json({ error: "Please provide HSN code or GST rate." });
    }

    const response = await admin.graphql(mutation, { variables: { metafields } });
    const data = await response.json();
    const errors = data.data?.metafieldsSet?.userErrors;
    if (errors?.length) {
      return json({ error: errors[0].message });
    }
    return json({ success: true, productId });
  }

  if (intent === "bulk-save-hsn") {
    const rowsJson = formData.get("rows") as string;
    let rows: Array<{ productId: string; hsnCode: string; gstRate: string }> = [];
    try {
      rows = JSON.parse(rowsJson);
    } catch {
      return json({ error: "Invalid CSV data" });
    }

    const mutation = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `;

    let updated = 0;
    for (const row of rows) {
      if (!row.productId) continue;
      const metafields = [];
      const gid = row.productId.startsWith("gid://") ? row.productId : `gid://shopify/Product/${row.productId}`;
      if (row.hsnCode) metafields.push({ ownerId: gid, namespace: METAFIELD_NAMESPACE, key: HSN_KEY, value: row.hsnCode, type: "single_line_text_field" });
      if (row.gstRate) metafields.push({ ownerId: gid, namespace: METAFIELD_NAMESPACE, key: GST_RATE_KEY, value: row.gstRate, type: "single_line_text_field" });
      if (metafields.length === 0) continue;
      await admin.graphql(mutation, { variables: { metafields } });
      updated++;
    }
    return json({ success: true, updated });
  }

  return json({ error: "Unknown action" });
};

// ─── Component ───────────────────────────────────────────────────────────────

type Product = {
  id: string;
  numericId: string;
  title: string;
  status: string;
  image: string | null;
  hsnCode: string;
  gstRate: string;
};

function EditHsnModal({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<typeof action>();
  const [hsn, setHsn] = useState(product?.hsnCode ?? "");
  const [gst, setGst] = useState(product?.gstRate ?? "");

  useEffect(() => {
    setHsn(product?.hsnCode ?? "");
    setGst(product?.gstRate ?? "");
  }, [product]);

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  const saving = fetcher.state !== "idle";

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={`Edit HSN & GST — ${product?.title}`}
      primaryAction={{
        content: saving ? "Saving..." : "Save",
        disabled: saving,
        onAction: () => {
          if (!product) return;
          const fd = new FormData();
          fd.append("intent", "save-hsn");
          fd.append("productId", product.id);
          fd.append("hsnCode", hsn);
          fd.append("gstRate", gst);
          fetcher.submit(fd, { method: "post" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        {fetcher.data && "error" in fetcher.data && (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="critical">{fetcher.data.error as string}</Banner>
          </div>
        )}
        <FormLayout>
          <TextField
            label="HSN / SAC Code"
            value={hsn}
            onChange={setHsn}
            placeholder="e.g. 6203"
            helpText="Harmonised System of Nomenclature code for this product."
            autoComplete="off"
          />
          <Select
            label="GST Rate (%)"
            options={[
              { label: "Select GST rate", value: "" },
              ...GST_RATES.map((r) => ({ label: `${r}%`, value: r })),
            ]}
            value={gst}
            onChange={setGst}
          />
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}

function HsnBadge({ code }: { code: string }) {
  if (!code) return <Badge tone="attention">Missing</Badge>;
  return <Badge tone="success">{code}</Badge>;
}

function GstBadge({ rate }: { rate: string }) {
  if (!rate) return <Badge tone="attention">Missing</Badge>;
  return <Badge>{`${rate}%`}</Badge>;
}

export default function ProductsPage() {
  const { products, pageInfo, tab, search } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedTab, setSelectedTab] = useState(
    ["all", "missing", "recent", "hsn-list"].indexOf(tab) > -1
      ? ["all", "missing", "recent", "hsn-list"].indexOf(tab)
      : 0
  );
  const [searchValue, setSearchValue] = useState(search);
  const revalidator = useRevalidator();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [csvImportToast, setCsvImportToast] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const bulkFetcher = useFetcher<{ success?: boolean; updated?: number; error?: string }>();

  const tabs = [
    { id: "all", content: "All Products" },
    { id: "missing", content: "Missing HSN" },
    { id: "recent", content: "Recently Added" },
    { id: "hsn-list", content: "HSN Codes" },
  ];

  const handleTabChange = useCallback(
    (idx: number) => {
      setSelectedTab(idx);
      const newParams = new URLSearchParams(searchParams);
      newParams.set("tab", tabs[idx].id);
      newParams.delete("cursor");
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
      const newParams = new URLSearchParams(searchParams);
      if (value) newParams.set("search", value);
      else newParams.delete("search");
      newParams.delete("cursor");
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  const handleClearSearch = useCallback(() => {
    handleSearch("");
  }, [handleSearch]);

  const filteredProducts =
    selectedTab === 1 ? products.filter((p: Product) => !p.hsnCode || !p.gstRate) :
    selectedTab === 3 ? products.filter((p: Product) => !!p.hsnCode) :
    products;

  // CSV download — client-side blob from loaded products
  const handleDownloadCSV = useCallback(() => {
    const header = "Product ID,Product Title,HSN Code,GST Rate\n";
    const rows = products.map((p: Product) =>
      `"${p.numericId}","${p.title.replace(/"/g, '""')}","${p.hsnCode}","${p.gstRate}"`
    ).join("\n");
    const csv = "﻿" + header + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "hsn-codes.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [products]);

  // CSV upload — parse and bulk submit
  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      const rows: Array<{ productId: string; hsnCode: string; gstRate: string }> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
        if (cols.length >= 3 && cols[0]) {
          rows.push({ productId: cols[0], hsnCode: cols[2] || "", gstRate: cols[3] || "" });
        }
      }
      if (rows.length > 0) {
        bulkFetcher.submit({ intent: "bulk-save-hsn", rows: JSON.stringify(rows) }, { method: "POST" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [bulkFetcher]);

  useEffect(() => {
    if (bulkFetcher.data?.success) setCsvImportToast(`Updated ${bulkFetcher.data.updated} products`);
    else if (bulkFetcher.data?.error) setCsvImportToast(`Error: ${bulkFetcher.data.error}`);
  }, [bulkFetcher.data]);

  const rowMarkup = filteredProducts.map((product: Product, idx: number) => (
    <IndexTable.Row id={product.id} key={product.id} position={idx}>
      <IndexTable.Cell>
        <InlineStack gap="300" blockAlign="center">
          {product.image ? (
            <Thumbnail source={product.image} alt={product.title} size="small" />
          ) : (
            <div style={{
              width: 40, height: 40, background: "#f4f6f8",
              borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Text as="span" variant="bodySm" tone="subdued">—</Text>
            </div>
          )}
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="medium">{product.title}</Text>
            <Badge tone={product.status === "ACTIVE" ? "success" : "attention"}>
              {product.status === "ACTIVE" ? "Active" : "Draft"}
            </Badge>
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <HsnBadge code={product.hsnCode} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <GstBadge rate={product.gstRate} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="slim"
          onClick={() => setEditProduct(product)}
        >
          Edit
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Frame>
      {csvImportToast && <Toast content={csvImportToast} onDismiss={() => setCsvImportToast(null)} />}
      {/* Hidden CSV file input */}
      <input ref={csvInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSVUpload} />
    <Page
      title="Products & HSN"
      secondaryActions={[
        { content: "Download CSV", onAction: handleDownloadCSV },
        { content: "Import CSV", onAction: () => csvInputRef.current?.click() },
      ]}
    >
      <TitleBar title="Products & HSN" />
      <BlockStack gap="400">

        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error as string}</Banner>
        )}
        {bulkFetcher.state !== "idle" && (
          <Banner tone="info">Updating HSN codes, please wait…</Banner>
        )}

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} fitted>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e1e3e5" }}>
              <TextField
                label=""
                labelHidden
                placeholder="Search products..."
                value={searchValue}
                onChange={handleSearch}
                clearButton
                onClearButtonClick={handleClearSearch}
                autoComplete="off"
              />
            </div>

            {filteredProducts.length === 0 ? (
              <EmptyState
                heading={selectedTab === 1 ? "All products have HSN codes!" : "No products found"}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd" tone="subdued">
                  {selectedTab === 1
                    ? "Great job! All your products have HSN codes assigned."
                    : "Try adjusting your search."}
                </Text>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={filteredProducts.length}
                headings={[
                  { title: "Product" },
                  { title: "HSN Code" },
                  { title: "GST Rate" },
                  { title: "Action" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Tabs>

        </Card>

        {/* Pagination — outside Card to avoid overflow:hidden clipping */}
        {(pageInfo.hasNextPage || pageInfo.hasPreviousPage) && (
          <div style={{
            position: "sticky", bottom: 0,
            background: "var(--p-color-bg-surface)",
            borderTop: "1px solid var(--p-color-border)",
            zIndex: 2,
          }}>
            <Box paddingBlock="300" paddingInline="400">
              <InlineStack align="center">
                <Pagination
                  hasPrevious={pageInfo.hasPreviousPage}
                  onPrevious={() => {
                    const p = new URLSearchParams(searchParams);
                    p.set("cursor", pageInfo.startCursor || "");
                    p.set("dir", "prev");
                    setSearchParams(p);
                  }}
                  hasNext={pageInfo.hasNextPage}
                  onNext={() => {
                    const p = new URLSearchParams(searchParams);
                    p.set("cursor", pageInfo.endCursor || "");
                    p.delete("dir");
                    setSearchParams(p);
                  }}
                />
              </InlineStack>
            </Box>
          </div>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm">About HSN Codes</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              HSN (Harmonised System of Nomenclature) codes are required on GST invoices for products
              with annual turnover above ₹1.5 crore. Assign the correct HSN code and GST rate to each
              product so they appear correctly on invoices.
            </Text>
            <InlineStack gap="300">
              <div>
                <Badge tone="attention">Missing</Badge>
                <Text as="span" variant="bodySm"> — No HSN code assigned</Text>
              </div>
              <div>
                <Badge tone="success">1234</Badge>
                <Text as="span" variant="bodySm"> — HSN code assigned</Text>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

      </BlockStack>

      <EditHsnModal
        key={editProduct?.id ?? "modal"}
        product={editProduct}
        onClose={() => { setEditProduct(null); revalidator.revalidate(); }}
      />
    </Page>
    </Frame>
  );
}
