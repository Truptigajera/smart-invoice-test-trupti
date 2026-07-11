import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  InlineStack,
  Thumbnail,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";

// ─── Types ────────────────────────────────────────────────────────────────────

type Collection = {
  id: string;
  title: string;
  productsCount: number;
  image: string | null;
};

type LoaderData = {
  collections: Collection[];
};

type ActionData =
  | { success: true; updated: number }
  | { error: string };

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const query = `
    query GetCollections($first: Int!) {
      collections(first: $first) {
        edges {
          node {
            id
            title
            productsCount { count }
            image { url }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query, { variables: { first: 50 } });
  const data = await response.json();

  const collections: Collection[] = (data.data?.collections?.edges || []).map(
    (edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      productsCount: edge.node.productsCount?.count ?? 0,
      image: edge.node.image?.url ?? null,
    })
  );

  return json<LoaderData>({ collections });
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "apply-collection-hsn") {
    const collectionId = formData.get("collectionId") as string;
    const hsnCode = (formData.get("hsnCode") as string | null)?.trim() ?? "";
    const gstRate = (formData.get("gstRate") as string | null)?.trim() ?? "";

    if (!collectionId) {
      return json<ActionData>({ error: "Missing collection ID." });
    }
    if (!hsnCode && !gstRate) {
      return json<ActionData>({ error: "Please enter an HSN code or GST rate before applying." });
    }

    // 1. Fetch all products in the collection
    const productsQuery = `
      query GetCollectionProducts($id: ID!) {
        collection(id: $id) {
          products(first: 100) {
            edges {
              node {
                id
                variants(first: 10) {
                  edges { node { id } }
                }
              }
            }
          }
        }
      }
    `;

    const productsResponse = await admin.graphql(productsQuery, {
      variables: { id: collectionId },
    });
    const productsData = await productsResponse.json();
    const productEdges: any[] =
      productsData.data?.collection?.products?.edges ?? [];

    if (productEdges.length === 0) {
      return json<ActionData>({ success: true, updated: 0 });
    }

    // 2. Build metafields mutation
    const metafieldsMutation = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value }
          userErrors { field message }
        }
      }
    `;

    let updated = 0;

    for (const edge of productEdges) {
      const productId: string = edge.node.id;
      const metafields: any[] = [];

      if (hsnCode) {
        metafields.push({
          ownerId: productId,
          namespace: "gst",
          key: "hsn_code",
          value: hsnCode,
          type: "single_line_text_field",
        });
      }
      if (gstRate) {
        metafields.push({
          ownerId: productId,
          namespace: "gst",
          key: "gst_rate",
          value: gstRate,
          type: "single_line_text_field",
        });
      }

      if (metafields.length === 0) continue;

      const mutationResponse = await admin.graphql(metafieldsMutation, {
        variables: { metafields },
      });
      const mutationData = await mutationResponse.json();
      const userErrors = mutationData.data?.metafieldsSet?.userErrors ?? [];
      if (userErrors.length === 0) {
        updated++;
      }
    }

    return json<ActionData>({ success: true, updated });
  }

  return json<ActionData>({ error: "Unknown action." });
};

// ─── Collection Card ─────────────────────────────────────────────────────────

function CollectionCard({ collection }: { collection: Collection }) {
  const fetcher = useFetcher<ActionData>();

  const [hsnInputs, setHsnInputs] = useState<Record<string, string>>({});
  const [gstInputs, setGstInputs] = useState<Record<string, string>>({});

  const colId = collection.id;
  const hsn = hsnInputs[colId] ?? "";
  const gst = gstInputs[colId] ?? "";

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;

  const handleApply = () => {
    const fd = new FormData();
    fd.append("intent", "apply-collection-hsn");
    fd.append("collectionId", colId);
    fd.append("hsnCode", hsn);
    fd.append("gstRate", gst);
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header: thumbnail + title + count */}
        <InlineStack gap="300" blockAlign="center">
          {collection.image ? (
            <Thumbnail
              source={collection.image}
              alt={collection.title}
              size="small"
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                background: "#f4f6f8",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Text as="span" variant="bodySm" tone="subdued">
                —
              </Text>
            </div>
          )}
          <BlockStack gap="050">
            <Text as="h2" variant="headingSm" fontWeight="semibold">
              {collection.title}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {collection.productsCount === 1
                ? "1 product"
                : `${collection.productsCount} products`}
            </Text>
          </BlockStack>
        </InlineStack>

        {/* Inputs */}
        <InlineStack gap="300" blockAlign="end" wrap={false}>
          <div style={{ flex: 1 }}>
            <TextField
              label="HSN Code"
              value={hsn}
              onChange={(val) =>
                setHsnInputs((prev) => ({ ...prev, [colId]: val }))
              }
              placeholder="e.g. 620342"
              helpText="6–8 digits"
              autoComplete="off"
              maxLength={8}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="GST %"
              value={gst}
              onChange={(val) =>
                setGstInputs((prev) => ({ ...prev, [colId]: val }))
              }
              placeholder="0, 5, 12, 18 or 28"
              helpText="Enter GST rate"
              autoComplete="off"
            />
          </div>
        </InlineStack>

        {/* Action row */}
        <InlineStack gap="300" blockAlign="center">
          <Button
            variant="primary"
            onClick={handleApply}
            loading={isSubmitting}
            disabled={isSubmitting || (!hsn && !gst)}
          >
            Apply to All Products in Collection
          </Button>

          {/* Inline feedback */}
          {result && "success" in result && result.success && (
            <Text as="span" variant="bodySm" tone="success">
              {result.updated === 0
                ? "No products to update."
                : `Updated ${result.updated} ${result.updated === 1 ? "product" : "products"}`}
            </Text>
          )}
          {result && "error" in result && (
            <Text as="span" variant="bodySm" tone="critical">
              {result.error}
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function CollectionsPage() {
  const { collections } = useLoaderData<LoaderData>();

  return (
    <Page title="Collection Rules — HSN & GST">
      <TitleBar title="Collection Rules — HSN & GST" />
      <BlockStack gap="400">
        <Banner tone="info">
          Apply HSN code and GST% to all products in a collection at once.
          Individual product overrides still take priority.
        </Banner>

        {collections.length === 0 ? (
          <EmptyState
            heading="No collections found"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <Text as="p" variant="bodyMd" tone="subdued">
              Create collections in your Shopify admin to bulk-assign HSN codes
              and GST rates.
            </Text>
          </EmptyState>
        ) : (
          collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))
        )}
      </BlockStack>
    </Page>
  );
}
