import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
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
  Modal,
  FormLayout,
  EmptyState,
  Box,
  Banner,
  Toast,
  Frame,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";

  const customers = await prisma.b2BCustomer.findMany({
    where: {
      shopId: shop.id,
      ...(search ? {
        OR: [
          { companyName: { contains: search, mode: "insensitive" } },
          { gstin: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return json({ customers, shopId: shop.id, shopDomain: session.shop, search });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save") {
    const id = formData.get("id") as string | null;
    const companyName = (formData.get("companyName") as string)?.trim();
    const gstin = (formData.get("gstin") as string)?.trim().toUpperCase();
    const email = (formData.get("email") as string)?.trim() || null;
    const phone = (formData.get("phone") as string)?.trim() || null;
    const address = (formData.get("address") as string)?.trim() || null;
    const city = (formData.get("city") as string)?.trim() || null;
    const state = (formData.get("state") as string)?.trim() || null;
    const stateCode = (formData.get("stateCode") as string)?.trim() || null;
    const pincode = (formData.get("pincode") as string)?.trim() || null;
    const notes = (formData.get("notes") as string)?.trim() || null;

    if (!companyName || !gstin) {
      return json({ error: "Company name and GSTIN are required" }, { status: 400 });
    }
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      return json({ error: "Invalid GSTIN format" }, { status: 400 });
    }

    const data = { shopId: shop.id, companyName, gstin, email, phone, address, city, state, stateCode, pincode, notes };

    try {
      if (id) {
        await prisma.b2BCustomer.update({ where: { id }, data });
      } else {
        await prisma.b2BCustomer.create({ data: { ...data, updatedAt: new Date() } });
      }
      return json({ success: true });
    } catch (err: any) {
      if (err?.code === "P2002") return json({ error: "A customer with this GSTIN already exists" }, { status: 409 });
      return json({ error: "Failed to save customer" }, { status: 500 });
    }
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.b2BCustomer.delete({ where: { id } });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Customer Form Modal ───────────────────────────────────────────────────────

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  editCustomer: null | {
    id: string; companyName: string; gstin: string; email: string | null;
    phone: string | null; address: string | null; city: string | null;
    state: string | null; stateCode: string | null; pincode: string | null; notes: string | null;
  };
}

function CustomerFormModal({ open, onClose, editCustomer }: CustomerFormProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const gstinFetcher = useFetcher<{
    stateCode?: string; state?: string; businessName?: string | null;
    tradeName?: string | null; address?: string | null; city?: string | null;
    pincode?: string | null; fromApi?: boolean; error?: string;
  }>();
  const isLoading = fetcher.state !== "idle";
  const isFetchingGstin = gstinFetcher.state === "loading";

  const [form, setForm] = useState({
    companyName: "", gstin: "", email: "", phone: "",
    address: "", city: "", state: "", stateCode: "", pincode: "", notes: "",
  });

  useEffect(() => {
    if (editCustomer) {
      setForm({
        companyName: editCustomer.companyName,
        gstin: editCustomer.gstin,
        email: editCustomer.email || "",
        phone: editCustomer.phone || "",
        address: editCustomer.address || "",
        city: editCustomer.city || "",
        state: editCustomer.state || "",
        stateCode: editCustomer.stateCode || "",
        pincode: editCustomer.pincode || "",
        notes: editCustomer.notes || "",
      });
    } else {
      setForm({ companyName: "", gstin: "", email: "", phone: "", address: "", city: "", state: "", stateCode: "", pincode: "", notes: "" });
    }
  }, [editCustomer, open]);

  useEffect(() => {
    if (fetcher.data?.success) onClose();
  }, [fetcher.data, onClose]);

  useEffect(() => {
    const d = gstinFetcher.data;
    if (!d || d.error) return;
    setForm((f) => ({
      ...f,
      ...(d.businessName ? { companyName: d.tradeName || d.businessName || f.companyName } : {}),
      ...(d.address ? { address: d.address } : {}),
      ...(d.city ? { city: d.city } : {}),
      ...(d.state ? { state: d.state } : {}),
      ...(d.stateCode ? { stateCode: d.stateCode } : {}),
      ...(d.pincode ? { pincode: d.pincode } : {}),
    }));
  }, [gstinFetcher.data]);

  const field = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const handleFetchGstin = () => {
    if (form.gstin.length === 15) {
      gstinFetcher.load(`/api/gstin-lookup?gstin=${encodeURIComponent(form.gstin)}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editCustomer ? "Edit B2B Customer" : "Add B2B Customer"}
      primaryAction={{
        content: "Save",
        loading: isLoading,
        onAction: () => {
          const data: Record<string, string> = { intent: "save", ...form };
          if (editCustomer) data.id = editCustomer.id;
          fetcher.submit(data, { method: "POST" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        {fetcher.data?.error && (
          <Box paddingBlockEnd="300">
            <Banner tone="critical">{fetcher.data.error}</Banner>
          </Box>
        )}
        {gstinFetcher.data?.fromApi && (
          <Box paddingBlockEnd="300">
            <Banner tone="success">Business details auto-filled from GST registry. Please verify and save.</Banner>
          </Box>
        )}
        {gstinFetcher.data?.error && (
          <Box paddingBlockEnd="300">
            <Banner tone="warning">{gstinFetcher.data.error}</Banner>
          </Box>
        )}
        <FormLayout>
          <FormLayout.Group>
            <TextField label="Company Name *" value={form.companyName} onChange={field("companyName")} autoComplete="organization" />
            <TextField
              label="GSTIN *"
              value={form.gstin}
              onChange={(v) => field("gstin")(v.toUpperCase().slice(0, 15))}
              autoComplete="off"
              helpText="15-character GST Identification Number"
              connectedRight={
                <Button
                  onClick={handleFetchGstin}
                  disabled={form.gstin.length !== 15 || isFetchingGstin}
                  loading={isFetchingGstin}
                  variant="secondary"
                  size="slim"
                >
                  Fetch
                </Button>
              }
            />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField label="Email" type="email" value={form.email} onChange={field("email")} autoComplete="email" />
            <TextField label="Phone" type="tel" value={form.phone} onChange={field("phone")} autoComplete="tel" />
          </FormLayout.Group>
          <TextField label="Address" value={form.address} onChange={field("address")} autoComplete="street-address" multiline={2} />
          <FormLayout.Group>
            <TextField label="City" value={form.city} onChange={field("city")} autoComplete="address-level2" />
            <TextField label="State" value={form.state} onChange={field("state")} autoComplete="address-level1" />
            <TextField label="State Code" value={form.stateCode} onChange={field("stateCode")} autoComplete="off" placeholder="e.g. 27" />
            <TextField label="Pincode" value={form.pincode} onChange={field("pincode")} autoComplete="postal-code" />
          </FormLayout.Group>
          <TextField label="Notes" value={form.notes} onChange={field("notes")} autoComplete="off" multiline={2} />
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { customers, search, shopDomain } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const deleteFetcher = useFetcher<{ success?: boolean }>();

  const [modalOpen, setModalOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<CustomerFormProps["editCustomer"]>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(search);

  const openAdd = useCallback(() => { setEditCustomer(null); setModalOpen(true); }, []);
  const openEdit = useCallback((c: typeof customers[0]) => {
    setEditCustomer(c);
    setModalOpen(true);
  }, []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const handleSearch = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    if (searchValue) p.set("q", searchValue); else p.delete("q");
    setSearchParams(p);
  }, [searchValue, searchParams, setSearchParams]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Delete this B2B customer?")) return;
    deleteFetcher.submit({ intent: "delete", id }, { method: "POST" });
  }, [deleteFetcher]);

  useEffect(() => {
    if (deleteFetcher.data?.success) setToast("Customer deleted");
  }, [deleteFetcher.data]);

  const rowMarkup = customers.map((c, i) => (
    <IndexTable.Row id={c.id} key={c.id} position={i}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{c.companyName}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{c.gstin}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{c.email || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{c.city ? `${c.city}, ${c.state}` : (c.state || "—")}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="150">
          <Button size="slim" variant="secondary" onClick={() => openEdit(c)}>Edit</Button>
          <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(c.id)}>Delete</Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Frame>
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
      <Page
        title="B2B Customers"
        primaryAction={{ content: "Add Customer", onAction: openAdd }}
        secondaryActions={[
          {
            content: "Copy Collection Link",
            onAction: () => {
              const url = `${window.location.origin}/collect-gstin/${encodeURIComponent(shopDomain)}`;
              navigator.clipboard.writeText(url).then(() => setToast("Collection link copied! Share it with your B2B buyers."));
            },
          },
        ]}
      >
        <TitleBar title="B2B Customers" />
        <Layout>
          <Layout.Section>
            <Banner tone="info">
              Add B2B customers with their GSTIN here. Their GST number will be auto-used on invoices when an order is placed from their email.
              Use <strong>Copy Collection Link</strong> to share a form with buyers so they can submit their GSTIN themselves.
            </Banner>
          </Layout.Section>
          <Layout.Section>
            <Card padding="0">
              <Box paddingInline="400" paddingBlock="300">
                <InlineStack gap="200" blockAlign="end">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label=""
                      labelHidden
                      placeholder="Search by company name, GSTIN or email…"
                      value={searchValue}
                      onChange={setSearchValue}
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={() => { setSearchValue(""); setSearchParams(new URLSearchParams()); }}
                    />
                  </div>
                  <Button onClick={handleSearch} variant="secondary">Search</Button>
                </InlineStack>
              </Box>

              {customers.length === 0 ? (
                <EmptyState
                  heading="No B2B customers yet"
                  action={{ content: "Add Customer", onAction: openAdd }}
                  image=""
                >
                  <p>Add B2B customers with their GSTIN to auto-populate invoices.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "customer", plural: "customers" }}
                  itemCount={customers.length}
                  headings={[
                    { title: "Company Name" },
                    { title: "GSTIN" },
                    { title: "Email" },
                    { title: "Location" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>

        <CustomerFormModal
          open={modalOpen}
          onClose={closeModal}
          editCustomer={editCustomer}
        />
      </Page>
    </Frame>
  );
}
