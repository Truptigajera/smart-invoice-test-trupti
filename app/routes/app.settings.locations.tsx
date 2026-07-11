import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Badge,
  Banner,
  InlineStack,
  Divider,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { STATE_CODES } from "~/lib/gst";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShopifyAddress {
  address1: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
}

interface ShopifyLocation {
  id: string;
  name: string;
  address: ShopifyAddress;
  isActive: boolean;
}

interface SavedLocation {
  id: string;
  locationGid: string;
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  isDefault: boolean;
}

interface LocationEditState {
  gstin: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Fetch Shopify locations
  const response = await admin.graphql(`
    query {
      locations(first: 20) {
        edges {
          node {
            id
            name
            address {
              address1
              city
              province
              zip
              country
            }
            isActive
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const locations: ShopifyLocation[] =
    responseJson.data?.locations?.edges?.map(
      (edge: { node: ShopifyLocation }) => edge.node
    ) ?? [];

  // Fetch shop record
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!shop) {
    return json({ locations, savedLocations: [] as SavedLocation[], shopId: "" });
  }

  // Fetch saved location overrides
  const savedLocations = await prisma.shopLocation.findMany({
    where: { shopId: shop.id },
  });

  return json({
    locations,
    savedLocations: savedLocations as SavedLocation[],
    shopId: shop.id,
  });
};

// ─── Action ─────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  if (intent === "save-location") {
    const locationGid = formData.get("locationGid") as string;
    const name = (formData.get("name") as string) ?? "";
    const gstin = (formData.get("gstin") as string) ?? "";
    const address = (formData.get("address") as string) ?? "";
    const city = (formData.get("city") as string) ?? "";
    const state = (formData.get("state") as string) ?? "";
    const stateCode = (formData.get("stateCode") as string) ?? "";
    const pincode = (formData.get("pincode") as string) ?? "";
    const isDefault = formData.get("isDefault") === "true";

    // If setting as default, clear all others first
    if (isDefault) {
      await prisma.shopLocation.updateMany({
        where: { shopId: shop.id },
        data: { isDefault: false },
      });
    }

    await prisma.shopLocation.upsert({
      where: {
        shopId_locationGid: {
          shopId: shop.id,
          locationGid,
        },
      },
      update: {
        name,
        gstin: gstin || null,
        address: address || null,
        city: city || null,
        state: state || null,
        stateCode: stateCode || null,
        pincode: pincode || null,
        isDefault,
      },
      create: {
        shopId: shop.id,
        locationGid,
        name,
        gstin: gstin || null,
        address: address || null,
        city: city || null,
        state: state || null,
        stateCode: stateCode || null,
        pincode: pincode || null,
        isDefault,
      },
    });

    return json({ success: true });
  }

  if (intent === "delete-location") {
    const locationGid = formData.get("locationGid") as string;
    await prisma.shopLocation.deleteMany({
      where: { shopId: shop.id, locationGid },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ─── State options from STATE_CODES ─────────────────────────────────────────

const stateOptions = [
  { label: "Select State", value: "" },
  ...Object.entries(STATE_CODES).map(([code, name]) => ({
    label: `${name} (${code})`,
    value: code,
  })),
];

// ─── LocationCard component ──────────────────────────────────────────────────

function LocationCard({
  location,
  saved,
  shopId,
}: {
  location: ShopifyLocation;
  saved: SavedLocation | undefined;
  shopId: string;
}) {
  const fetcher = useFetcher();

  const [form, setForm] = useState<LocationEditState>({
    gstin: saved?.gstin ?? "",
    address: saved?.address ?? "",
    city: saved?.city ?? "",
    state: saved?.state ?? "",
    stateCode: saved?.stateCode ?? "",
    pincode: saved?.pincode ?? "",
    isDefault: saved?.isDefault ?? false,
  });

  const handleField = useCallback(
    <K extends keyof LocationEditState>(field: K) =>
      (value: LocationEditState[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
      },
    []
  );

  const handleStateCode = useCallback((value: string) => {
    setForm((prev) => ({
      ...prev,
      stateCode: value,
      state: value ? STATE_CODES[value] ?? "" : "",
    }));
  }, []);

  const handleToggleDefault = useCallback(() => {
    setForm((prev) => ({ ...prev, isDefault: !prev.isDefault }));
  }, []);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "save-location");
    fd.append("locationGid", location.id);
    fd.append("name", location.name);
    fd.append("gstin", form.gstin);
    fd.append("address", form.address);
    fd.append("city", form.city);
    fd.append("state", form.state);
    fd.append("stateCode", form.stateCode);
    fd.append("pincode", form.pincode);
    fd.append("isDefault", String(form.isDefault));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, location.id, form]);

  const handleDelete = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "delete-location");
    fd.append("locationGid", location.id);
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, location.id]);

  const isSaving = fetcher.state !== "idle";

  const shopifyAddr = [
    location.address.address1,
    location.address.city,
    location.address.province,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header row */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">
              {location.name}
            </Text>
            {shopifyAddr ? (
              <Text variant="bodySm" as="p" tone="subdued">
                {shopifyAddr}
              </Text>
            ) : null}
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            {form.isDefault && <Badge tone="success">Default</Badge>}
            <Badge tone={location.isActive ? "success" : "critical"}>
              {location.isActive ? "Active" : "Inactive"}
            </Badge>
          </InlineStack>
        </InlineStack>

        <Divider />

        {/* Editable fields */}
        <BlockStack gap="300">
          <TextField
            label="GSTIN for this location"
            value={form.gstin}
            onChange={handleField("gstin")}
            placeholder="e.g. 27AABCU9603R1ZX"
            maxLength={15}
            autoComplete="off"
          />
          <TextField
            label="Custom Address (optional override)"
            value={form.address}
            onChange={handleField("address")}
            placeholder="Street / building number"
            autoComplete="off"
          />
          <InlineStack gap="300" wrap>
            <div style={{ flex: 1, minWidth: "140px" }}>
              <TextField
                label="City"
                value={form.city}
                onChange={handleField("city")}
                placeholder="City"
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <Select
                label="State"
                options={stateOptions}
                value={form.stateCode}
                onChange={handleStateCode}
              />
            </div>
            <div style={{ flex: 1, minWidth: "100px" }}>
              <TextField
                label="Pincode"
                value={form.pincode}
                onChange={handleField("pincode")}
                placeholder="400001"
                maxLength={6}
                autoComplete="off"
              />
            </div>
          </InlineStack>
        </BlockStack>

        {/* Actions row */}
        <InlineStack align="space-between" blockAlign="center">
          <Button
            variant={form.isDefault ? "primary" : "plain"}
            onClick={handleToggleDefault}
            tone={form.isDefault ? "success" : undefined}
          >
            {form.isDefault ? "Default location" : "Set as Default"}
          </Button>
          <InlineStack gap="200">
            {saved && (
              <Button
                tone="critical"
                variant="plain"
                onClick={handleDelete}
                disabled={isSaving}
              >
                Remove override
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              loading={isSaving}
            >
              Save
            </Button>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LocationsSettingsPage() {
  const { locations, savedLocations, shopId } = useLoaderData<typeof loader>();

  const getSaved = (gid: string) =>
    savedLocations.find((s) => s.locationGid === gid);

  return (
    <Page>
      <TitleBar title="Store Locations" />
      <Layout>
        {/* Info Banner */}
        <Layout.Section>
          <Banner tone="info">
            <Text as="p">
              Configure separate GSTIN and address per location. The default
              location will be used for invoice seller details if{" "}
              <strong>Override Supplier Address</strong> is enabled.
            </Text>
          </Banner>
        </Layout.Section>

        {/* Locations list */}
        <Layout.Section>
          {locations.length === 0 ? (
            <Banner tone="warning">
              <Text as="p">
                No locations found in your Shopify store. Please add at least
                one location from your Shopify admin (Settings &rarr; Locations).
              </Text>
            </Banner>
          ) : (
            <BlockStack gap="400">
              {locations.map((loc) => (
                <LocationCard
                  key={loc.id}
                  location={loc}
                  saved={getSaved(loc.id)}
                  shopId={shopId}
                />
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
