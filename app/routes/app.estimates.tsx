import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  IndexTable,
  TextField,
  Select,
  EmptyState,
  Pagination,
  Box,
  Spinner,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { mergeCustomization } from "~/lib/customization.types";
import type { EstimateData } from "~/components/EstimatePDFTemplate";
import { canUseFeature } from "~/lib/plan-features";
import { openUpgradePopup } from "~/components/PlanLimitModal";
import { STATE_CODES, determineTaxType, getIndianStateCode, getStateCodeFromGstin } from "~/lib/gst";

const PAGE_SIZE = 25;

// ── GraphQL: list query ───────────────────────────────────────────────────────

const DRAFT_ORDERS_QUERY = `
  query getDraftOrders($first: Int!, $after: String, $query: String) {
    draftOrders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
        hasPreviousPage
        startCursor
      }
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          status
          customer {
            displayName
            email
          }
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          invoiceUrl
          lineItems(first: 5) {
            edges {
              node {
                title
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

// ── GraphQL: detail query for PDF generation ──────────────────────────────────

const DRAFT_ORDER_DETAIL_QUERY = `
  query getDraftOrderDetail($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      createdAt
      note2
      customer {
        displayName
        email
        phone
      }
      billingAddress {
        address1
        address2
        city
        province
        provinceCode
        zip
        phone
      }
      lineItems(first: 100) {
        edges {
          node {
            title
            variantTitle
            quantity
            product {
              metafields(namespace: "gst_invoice", first: 5) {
                edges { node { key value } }
              }
            }
            originalUnitPriceSet { shopMoney { amount } }
            discountedUnitPriceSet { shopMoney { amount } }
            taxLines {
              rate
              priceSet { shopMoney { amount } }
            }
            discountedTotalSet { shopMoney { amount } }
          }
        }
      }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
    }
  }
`;

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "generate-estimate-pdf") {
    const draftOrderId = formData.get("draftOrderId") as string;

    // Estimate PDFs are a Pro feature — free stores can browse the list and see what it does
    const planShop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { currentPlan: true },
    });
    if (!canUseFeature(planShop?.currentPlan ?? "free", "estimates")) {
      return json({ error: "Estimate PDFs are available on the Pro plan.", upgradeRequired: true }, { status: 403 });
    }

    const resp = await admin.graphql(DRAFT_ORDER_DETAIL_QUERY, {
      variables: { id: draftOrderId },
    });
    const gqlData = await resp.json();
    const draftOrder = gqlData.data?.draftOrder;
    if (!draftOrder) return json({ error: "Draft order not found" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItems = draftOrder.lineItems.edges.map((edge: any) => {
      const node = edge.node;
      const taxRate =
        node.taxLines.length > 0
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Math.round(node.taxLines.reduce((s: number, t: any) => s + t.rate, 0) * 100)
          : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taxAmount = node.taxLines.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: number, t: any) => s + parseFloat(t.priceSet.shopMoney.amount),
        0
      );
      const unitPrice = parseFloat(node.originalUnitPriceSet.shopMoney.amount);
      const discountedUnitPrice = parseFloat(node.discountedUnitPriceSet.shopMoney.amount);
      const lineTotal = parseFloat(node.discountedTotalSet.shopMoney.amount) + taxAmount;

      return {
        title: node.title,
        variantTitle: node.variantTitle || null,
        quantity: node.quantity,
        unitPrice,
        discountedUnitPrice,
        taxRate,
        taxAmount,
        totalAmount: lineTotal,
        hsnCode:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node.product?.metafields?.edges?.find((m: any) => m.node.key === "hsn_code")?.node.value || null,
      };
    });

    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      include: { settings: true },
    });

    const templateId = shop?.settings?.templateId || "template-1";
    const savedCustomization = shop
      ? await prisma.templateCustomization.findUnique({
          where: { shopId_templateId: { shopId: shop.id, templateId } },
        })
      : null;
    const customization = mergeCustomization(savedCustomization);

    const billing = draftOrder.billingAddress;
    const addrLine = billing?.address1
      ? [billing.address1, billing.address2].filter(Boolean).join(", ")
      : null;
    // Buyer's GST state decides CGST+SGST vs IGST, and gives the full state name ("GJ" → "Gujarat")
    const buyerStateCode = getIndianStateCode(billing?.provinceCode || "", billing?.province || "");
    const sellerStateCode = shop?.stateCode || getStateCodeFromGstin(shop?.gstin || "");

    const estimate: EstimateData = {
      estimateNumber: draftOrder.name,
      estimateDate: draftOrder.createdAt,
      customerName: draftOrder.customer?.displayName || null,
      customerEmail: draftOrder.customer?.email || null,
      customerPhone: billing?.phone || draftOrder.customer?.phone || null,
      billingAddress: addrLine,
      billingCity: billing?.city || null,
      billingState: STATE_CODES[buyerStateCode] || billing?.province || billing?.provinceCode || null,
      taxType: determineTaxType(sellerStateCode, buyerStateCode),
      billingPincode: billing?.zip || null,
      lineItems,
      subtotal: parseFloat(draftOrder.subtotalPriceSet.shopMoney.amount),
      totalDiscount: parseFloat(draftOrder.totalDiscountsSet.shopMoney.amount),
      totalTax: parseFloat(draftOrder.totalTaxSet.shopMoney.amount),
      total: parseFloat(draftOrder.totalPriceSet.shopMoney.amount),
      note: draftOrder.note2 || null,
      shop: {
        businessName: shop?.businessName || null,
        gstin: shop?.gstin || null,
        address: shop?.address || null,
        city: shop?.city || null,
        state: shop?.state || null,
        pincode: shop?.pincode || null,
        phone: shop?.phone || null,
        email: shop?.email || null,
        logoUrl: shop?.logoUrl || null,
      },
    };

    // Ensure NotoSans fonts are registered before rendering (side-effect import of pdf.server.ts)
    await import("~/lib/pdf.server");
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { createElement } = await import("react");
    const { EstimatePDFTemplate } = await import("~/components/EstimatePDFTemplate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = createElement(EstimatePDFTemplate, { estimate, customization }) as any;
    const buffer = await renderToBuffer(el);

    const filename = `Estimate-${draftOrder.name.replace(/[#/\\]/g, "")}.pdf`;
    return json({ pdfBase64: buffer.toString("base64"), filename });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";
  const cursor = url.searchParams.get("cursor") || null;

  const queryParts: string[] = [];
  if (searchQuery) queryParts.push(`name:*${searchQuery}* OR email:*${searchQuery}*`);
  if (statusFilter) queryParts.push(`status:${statusFilter}`);
  if (dateFrom) queryParts.push(`created_at:>=${dateFrom}`);
  if (dateTo) queryParts.push(`created_at:<=${dateTo}`);
  const gqlQuery = queryParts.join(" AND ");

  type DraftOrderEdge = {
    node: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      status: string;
      customer: { displayName: string; email: string } | null;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      invoiceUrl: string | null;
      lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
    };
  };

  let draftOrdersData: {
    edges: DraftOrderEdge[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
      hasPreviousPage: boolean;
      startCursor: string | null;
    };
  } = {
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null, hasPreviousPage: false, startCursor: null },
  };

  // Shown instead of "No draft orders found" when Shopify couldn't be read (e.g. missing
  // read_draft_orders scope) — otherwise merchants think they simply have no drafts
  let loadError = false;
  try {
    const variables: Record<string, unknown> = { first: PAGE_SIZE, query: gqlQuery || null };
    if (cursor) variables.after = cursor;

    const response = await admin.graphql(DRAFT_ORDERS_QUERY, { variables });
    const data = await response.json();
    draftOrdersData = data.data?.draftOrders ?? draftOrdersData;
  } catch (err) {
    // admin.graphql throws on GraphQL/auth errors
    console.error("[estimates loader] GraphQL error:", err);
    loadError = true;
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { currentPlan: true },
  });

  return json({
    loadError,
    canDownload: canUseFeature(shop?.currentPlan ?? "free", "estimates"),
    storeHandle: session.shop.replace(".myshopify.com", ""),
    draftOrders: draftOrdersData.edges,
    pageInfo: draftOrdersData.pageInfo,
    searchQuery,
    statusFilter,
    dateFrom,
    dateTo,
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(amount: string, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
  }).format(parseFloat(amount));
}

// "INVOICE_SENT" → "Invoice sent" (Shopify admin shows statuses in sentence case)
function toTitleCase(status: string) {
  const s = (status || "").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusTone(status: string): "success" | "warning" | "attention" | undefined {
  switch (status?.toUpperCase()) {
    case "COMPLETED": return "success";
    case "INVOICE_SENT": return "attention";
    case "OPEN": return "warning";
    default: return undefined;
  }
}

function triggerPdfDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Row actions component (needs its own fetcher) ─────────────────────────────

type ActionData = { pdfBase64?: string; filename?: string; error?: string };

function EstimateRowActions({
  orderId,
  orderName,
  canDownload,
  storeHandle,
}: {
  orderId: string;
  orderName: string;
  canDownload: boolean;
  storeHandle: string;
}) {
  const fetcher = useFetcher<ActionData>();
  const isLoading = fetcher.state !== "idle";

  // Free plan: explain the feature in the shared upgrade popup instead of calling the server
  const showProPopup = () =>
    openUpgradePopup({
      title: "Estimate PDFs are a Pro feature",
      lines: [
        `Download ${orderName} as a GST quotation PDF — with HSN codes and CGST/SGST or IGST — to send to your customer.`,
        "Upgrade to Pro to download estimates for all your draft orders.",
      ],
    });

  useEffect(() => {
    if (fetcher.data?.pdfBase64 && fetcher.data?.filename) {
      triggerPdfDownload(fetcher.data.pdfBase64, fetcher.data.filename);
    }
  }, [fetcher.data]);

  const handleDownload = () => {
    const fd = new FormData();
    fd.append("intent", "generate-estimate-pdf");
    fd.append("draftOrderId", orderId);
    fetcher.submit(fd, { method: "post" });
  };

  const numericId = orderId.split("/").pop();

  return (
    <InlineStack gap="200" wrap={false} blockAlign="center">
      <Button size="slim" loading={isLoading} onClick={canDownload ? handleDownload : showProPopup}>
        {isLoading ? "Generating…" : "Download"}
      </Button>
      <Button
        url={`https://admin.shopify.com/store/${storeHandle}/draft_orders/${numericId}`}
        target="_blank"
        size="slim"
        variant="plain"
      >
        View
      </Button>
    </InlineStack>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function EstimatesPage() {
  const { draftOrders, pageInfo, searchQuery, statusFilter, dateFrom, dateTo, loadError, canDownload, storeHandle } =
    useLoaderData<typeof loader>();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [searchValue, setSearchValue] = useState(searchQuery);
  const [statusValue, setStatusValue] = useState(statusFilter);
  const [dateFromValue, setDateFromValue] = useState(dateFrom);
  const [dateToValue, setDateToValue] = useState(dateTo);

  const applyFilters = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    if (searchValue) p.set("q", searchValue); else p.delete("q");
    if (statusValue) p.set("status", statusValue); else p.delete("status");
    if (dateFromValue) p.set("dateFrom", dateFromValue); else p.delete("dateFrom");
    if (dateToValue) p.set("dateTo", dateToValue); else p.delete("dateTo");
    p.delete("cursor");
    setSearchParams(p);
  }, [searchValue, statusValue, dateFromValue, dateToValue, searchParams, setSearchParams]);

  const clearFilters = useCallback(() => {
    setSearchValue("");
    setStatusValue("");
    setDateFromValue("");
    setDateToValue("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const handleNextPage = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set("cursor", pageInfo.endCursor || "");
    setSearchParams(p);
  }, [pageInfo.endCursor, searchParams, setSearchParams]);

  const handlePrevPage = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.delete("cursor");
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  const hasFilters = !!(searchQuery || statusFilter || dateFrom || dateTo);

  const rowMarkup = draftOrders.map((edge, i) => {
    const order = edge.node;
    return (
      <IndexTable.Row id={order.id} key={order.id} position={i}>
        {/* Compact rows (bodySm, one line each) to match Shopify admin's own lists */}
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {order.name}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatDate(order.createdAt)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {order.customer?.displayName || "Guest"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatAmount(
              order.totalPriceSet.shopMoney.amount,
              order.totalPriceSet.shopMoney.currencyCode
            )}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusTone(order.status)}>
            {toTitleCase(order.status)}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {order.lineItems.edges.slice(0, 2).map((e) => e.node.title).join(", ")}
            {order.lineItems.edges.length > 2 && " …"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <EstimateRowActions orderId={order.id} orderName={order.name} canDownload={canDownload} storeHandle={storeHandle} />
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page title="Estimates" fullWidth>
      <TitleBar title="Estimates" />
      <Layout>
        <Layout.Section>
          {canDownload ? (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                Your Shopify draft orders — download any of them as a GST quotation PDF. Once a draft order is paid, it gets a GST invoice automatically.
              </Text>
            </Banner>
          ) : (
            <Banner
              tone="warning"
              title="Estimates — Pro feature"
              action={{ content: "Upgrade to Pro", url: "/app/billing" }}
            >
              <Text as="p" variant="bodySm">
                Browse your Shopify draft orders here. Downloading them as GST quotation PDFs needs the Pro plan.
              </Text>
            </Banner>
          )}
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            {/* Filters */}
            <Box paddingInline="400" paddingBlockStart="300" paddingBlockEnd="200">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="end">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label=""
                      labelHidden
                      placeholder="Search by draft order # or customer…"
                      value={searchValue}
                      onChange={setSearchValue}
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={clearFilters}
                    />
                  </div>
                  <Button onClick={applyFilters} variant="primary">Search</Button>
                  {hasFilters && (
                    <Button onClick={clearFilters} variant="plain" tone="critical">
                      Clear
                    </Button>
                  )}
                </InlineStack>
                <InlineStack gap="200" wrap>
                  <div style={{ minWidth: 170 }}>
                    <Select
                      label="Status"
                      options={[
                        { label: "All statuses", value: "" },
                        { label: "Open", value: "open" },
                        { label: "Invoice Sent", value: "invoice_sent" },
                        { label: "Completed", value: "completed" },
                      ]}
                      value={statusValue}
                      onChange={setStatusValue}
                    />
                  </div>
                  <div style={{ minWidth: 140 }}>
                    <TextField
                      label="From date"
                      type="date"
                      value={dateFromValue}
                      onChange={setDateFromValue}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ minWidth: 140 }}>
                    <TextField
                      label="To date"
                      type="date"
                      value={dateToValue}
                      onChange={setDateToValue}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Loading */}
            {isLoading && (
              <Box paddingBlock="600">
                <InlineStack align="center"><Spinner size="large" /></InlineStack>
              </Box>
            )}

            {/* Empty */}
            {!isLoading && loadError && (
              <Box padding="400">
                <Banner tone="critical" title="Couldn't load draft orders from Shopify">
                  <p>Please refresh the page. If this keeps happening, contact support.</p>
                </Banner>
              </Box>
            )}
            {!isLoading && !loadError && draftOrders.length === 0 && (
              <EmptyState heading="No draft orders found" image="">
                <p>
                  {hasFilters
                    ? "No draft orders match the current filters."
                    : "Create draft orders in your Shopify admin to see estimates here."}
                </p>
              </EmptyState>
            )}

            {/* Table */}
            {!isLoading && draftOrders.length > 0 && (
              <IndexTable
                resourceName={{ singular: "estimate", plural: "estimates" }}
                itemCount={draftOrders.length}
                headings={[
                  { title: "Draft Order #" },
                  { title: "Date" },
                  { title: "Customer" },
                  { title: "Total" },
                  { title: "Status" },
                  { title: "Items" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}

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
                    onPrevious={handlePrevPage}
                    hasNext={pageInfo.hasNextPage}
                    onNext={handleNextPage}
                  />
                </InlineStack>
              </Box>
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
