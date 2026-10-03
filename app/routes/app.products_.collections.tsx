import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Banner, InlineStack, Thumbnail, EmptyState, Select, Box, Divider,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { isValidGstRate, isValidHsnCode, VALID_GST_RATES } from "~/lib/gst";

// Must match the Products & HSN page and invoice creation — this page used to write to "gst",
// which nothing reads, so collection rules never reached any invoice
const METAFIELD_NAMESPACE = "gst_invoice";
const METAFIELDS_PER_CALL = 25; // metafieldsSet limit
const PRODUCT_LIMIT = 2500;

type Collection = { id: string; title: string; productsCount: number; image: string | null };
type ActionData = { success?: true; updated?: number; failed?: number; capped?: boolean; error?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`#graphql
    query GetCollections {
      collections(first: 250, sortKey: TITLE) {
        nodes { id title productsCount { count } image { url } }
      }
    }`);
  const data = await response.json();
  const collections: Collection[] = (data.data?.collections?.nodes || []).map((n: any) => ({
    id: n.id, title: n.title, productsCount: n.productsCount?.count ?? 0, image: n.image?.url ?? null,
  }));
  return json({ collections });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const collectionId = (formData.get("collectionId") as string) || "";
  const hsnCode = ((formData.get("hsnCode") as string) || "").trim();
  const gstRate = ((formData.get("gstRate") as string) || "").trim();

  if (!collectionId) return json<ActionData>({ error: "Missing collection." });
  if (!hsnCode && !gstRate) return json<ActionData>({ error: "Enter an HSN code or choose a GST rate." });
  if (hsnCode && !isValidHsnCode(hsnCode)) return json<ActionData>({ error: "HSN code must be 4, 6 or 8 digits." });
  if (gstRate && !isValidGstRate(gstRate)) return json<ActionData>({ error: "Please choose a valid GST rate." });

  // All products in the collection (used to stop at the first 100)
  const productIds: string[] = [];
  let after: string | null = null;
  do {
    const res = await admin.graphql(`#graphql
      query CollectionProducts($id: ID!, $after: String) {
        collection(id: $id) {
          products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
        }
      }`, { variables: { id: collectionId, after } });
    const body: any = await res.json();
    const page = body.data?.collection?.products;
    if (!page) break;
    productIds.push(...page.nodes.map((n: { id: string }) => n.id));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after && productIds.length < PRODUCT_LIMIT);

  const metafields = productIds.flatMap((ownerId) => [
    ...(hsnCode ? [{ ownerId, namespace: METAFIELD_NAMESPACE, key: "hsn_code", value: hsnCode, type: "single_line_text_field" }] : []),
    ...(gstRate ? [{ ownerId, namespace: METAFIELD_NAMESPACE, key: "gst_rate", value: gstRate, type: "single_line_text_field" }] : []),
  ]);

  // Batched (25 per call) instead of one API call per product
  const failedOwners = new Set<string>();
  for (let i = 0; i < metafields.length; i += METAFIELDS_PER_CALL) {
    const batch = metafields.slice(i, i + METAFIELDS_PER_CALL);
    const res = await admin.graphql(`#graphql
      mutation SetGst($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`, { variables: { metafields: batch } });
    const body: any = await res.json();
    if ((body.data?.metafieldsSet?.userErrors ?? []).length > 0 || body.errors) {
      batch.forEach((m) => failedOwners.add(m.ownerId));
    }
  }

  return json<ActionData>({
    success: true,
    updated: productIds.length - failedOwners.size,
    failed: failedOwners.size,
    capped: !!after,
  });
};

const rateOptions = [{ label: "Don't change", value: "" }, ...VALID_GST_RATES.map((r) => ({ label: `${r}%`, value: r }))];

function CollectionRow({ collection }: { collection: Collection }) {
  const fetcher = useFetcher<ActionData>();
  const [hsn, setHsn] = useState("");
  const [gst, setGst] = useState("");
  const busy = fetcher.state !== "idle";
  const r = fetcher.data;
  const hsnError = hsn && !isValidHsnCode(hsn) ? "4, 6 or 8 digits" : undefined;

  return (
    <Box paddingBlock="300" paddingInline="400">
      <InlineStack gap="400" blockAlign="center" wrap>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Thumbnail source={collection.image || ImageIcon} alt={collection.title} size="small" />
          <div style={{ width: 220 }}>
            <BlockStack gap="050">
              <Text as="h3" variant="bodySm" fontWeight="semibold" truncate>{collection.title}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{collection.productsCount} {collection.productsCount === 1 ? "product" : "products"}</Text>
            </BlockStack>
          </div>
        </InlineStack>
        <div style={{ width: 150 }}>
          <TextField label="HSN code" labelHidden placeholder="HSN code" value={hsn} autoComplete="off" error={hsnError}
            onChange={(v) => setHsn(v.replace(/\D/g, "").slice(0, 8))} />
        </div>
        <div style={{ width: 140 }}>
          <Select label="GST rate" labelHidden options={rateOptions} value={gst} onChange={setGst} />
        </div>
        <Button
          loading={busy} disabled={busy || (!hsn && !gst) || !!hsnError || collection.productsCount === 0}
          onClick={() => fetcher.submit({ collectionId: collection.id, hsnCode: hsn, gstRate: gst }, { method: "post" })}
        >
          Apply to {String(collection.productsCount)}
        </Button>
        {r?.success && (
          <Text as="span" variant="bodySm" tone={r.failed ? "critical" : "success"}>
            {`Updated ${r.updated} product${r.updated === 1 ? "" : "s"}`}
            {r.failed ? ` · ${r.failed} failed` : ""}
            {r.capped ? ` · stopped at ${PRODUCT_LIMIT}` : ""}
          </Text>
        )}
        {r?.error && <Text as="span" variant="bodySm" tone="critical">{r.error}</Text>}
      </InlineStack>
    </Box>
  );
}

export default function CollectionsPage() {
  const { collections } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const shown = collections.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Page title="Apply HSN & GST by collection" backAction={{ content: "Products & HSN", url: "/app/products" }} fullWidth>
      <TitleBar title="Apply by collection" />
      <BlockStack gap="400">
        <Banner tone="warning">
          <Text as="p" variant="bodySm">
            This sets the HSN code and/or GST rate on <strong>every product</strong> in the collection, replacing what they have now.
            Leave a box empty to keep that value. Fix single products afterwards on the Products & HSN page.
          </Text>
        </Banner>
        {collections.length === 0 ? (
          <Card>
            <EmptyState heading="No collections yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <Text as="p" variant="bodySm" tone="subdued">Create collections in Shopify admin (Products → Collections), e.g. "T-shirts" or "Jewellery", to set GST for a whole group at once.</Text>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <Box padding="300">
              <TextField label="Search collections" labelHidden placeholder="Search collections" value={query} onChange={setQuery} autoComplete="off" clearButton onClearButtonClick={() => setQuery("")} />
            </Box>
            {shown.map((c) => (
              <div key={c.id}>
                <Divider />
                <CollectionRow collection={c} />
              </div>
            ))}
            {shown.length === 0 && (
              <Box padding="400"><Text as="p" variant="bodySm" tone="subdued">No collections match "{query}".</Text></Box>
            )}
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
