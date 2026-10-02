import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button,
  IndexTable, TextField, Modal, FormLayout, EmptyState, Box, Banner, Toast, Frame, Tabs,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { STATE_CODES, validateGstin } from "~/lib/gst";
import { canUseFeature } from "~/lib/plan-features";
import { recalculateInvoice } from "~/lib/order-invoice.server";
import { openUpgradePopup } from "~/components/PlanLimitModal";

// Past invoices are rebuilt one order at a time from Shopify — keep one click reasonably fast
const MAX_PAST_INVOICES = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const search = (url.searchParams.get("q") || "").trim();
  const tab = url.searchParams.get("tab") === "pending" ? "pending" : "all";

  const [customers, pendingCount, invoiceCounts] = await Promise.all([
    prisma.b2BCustomer.findMany({
      where: {
        shopId: shop.id,
        ...(tab === "pending" ? { pendingApproval: true } : {}),
        ...(search ? {
          OR: [
            { companyName: { contains: search, mode: "insensitive" } },
            { gstin: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.b2BCustomer.count({ where: { shopId: shop.id, pendingApproval: true } }),
    // How many invoices already carry each GSTIN — shows the merchant the setup is working
    prisma.invoice.groupBy({
      by: ["buyerGstin"],
      where: { shopId: shop.id, invoiceType: { not: "CREDIT_NOTE" }, buyerGstin: { not: null } },
      _count: true,
    }),
  ]);

  const countByGstin = Object.fromEntries(invoiceCounts.map((g) => [g.buyerGstin ?? "", g._count]));

  return json({
    customers: customers.map((c) => ({ ...c, invoiceCount: countByGstin[c.gstin] ?? 0 })),
    pendingCount,
    shopDomain: session.shop,
    search,
    tab,
    canUse: canUseFeature(shop.currentPlan, "b2b-customers"),
    gstinLookupEnabled: Boolean(process.env.GSTIN_API_URL),
  });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const id = (formData.get("id") as string) || null;

  // Every write is scoped to this shop. The old code updated/deleted by id alone, so a
  // crafted request could change or remove another store's customers.
  const own = id
    ? await prisma.b2BCustomer.findFirst({ where: { id, shopId: shop.id } })
    : null;
  if (id && !own) return json({ error: "Customer not found" }, { status: 404 });

  if (intent === "delete" && own) {
    await prisma.b2BCustomer.delete({ where: { id: own.id } });
    return json({ success: true, message: "Customer deleted" });
  }

  if (!canUseFeature(shop.currentPlan, "b2b-customers")) {
    return json({ error: "B2B customers are available on the Pro plan." }, { status: 403 });
  }

  if (intent === "approve" && own) {
    await prisma.b2BCustomer.update({ where: { id: own.id }, data: { pendingApproval: false } });
    return json({ success: true, message: `${own.companyName} approved — their GSTIN will now be used on invoices` });
  }

  if (intent === "save") {
    const str = (k: string) => ((formData.get(k) as string) || "").trim();
    const companyName = str("companyName");
    const gstin = str("gstin").toUpperCase();
    const email = str("email").toLowerCase();

    if (!companyName) return json({ error: "Registered business name is required" }, { status: 400 });
    if (!validateGstin(gstin)) return json({ error: "This GSTIN is not valid — please check it (format and check digit)." }, { status: 400 });
    // Orders are matched to a customer by email, so without one the GSTIN would never be used
    if (!EMAIL_RE.test(email)) return json({ error: "Email is required — it's how orders are matched to this customer." }, { status: 400 });

    const emailTaken = await prisma.b2BCustomer.findFirst({
      where: { shopId: shop.id, email: { equals: email, mode: "insensitive" }, ...(own ? { NOT: { id: own.id } } : {}) },
      select: { companyName: true },
    });
    if (emailTaken) return json({ error: `This email is already used by ${emailTaken.companyName}.` }, { status: 409 });

    // State always comes from the GSTIN's first two digits (was a free-text field before)
    const stateCode = gstin.slice(0, 2);
    const data = {
      companyName, gstin, email,
      phone: str("phone") || null,
      address: str("address") || null,
      city: str("city") || null,
      pincode: str("pincode") || null,
      notes: str("notes") || null,
      stateCode,
      state: STATE_CODES[stateCode] || null,
      pendingApproval: false,
    };

    try {
      if (own) await prisma.b2BCustomer.update({ where: { id: own.id }, data });
      else await prisma.b2BCustomer.create({ data: { ...data, shopId: shop.id } });
      return json({ success: true, message: own ? "Customer updated" : "Customer added" });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        return json({ error: "A customer with this GSTIN already exists" }, { status: 409 });
      }
      return json({ error: "Failed to save customer" }, { status: 500 });
    }
  }

  // Rebuild this customer's earlier B2C invoices so they pick up the GSTIN
  if (intent === "apply-past" && own) {
    if (own.pendingApproval) return json({ error: "Approve this customer first." }, { status: 400 });
    if (!own.email) return json({ error: "Add an email for this customer first." }, { status: 400 });
    const past = await prisma.invoice.findMany({
      where: {
        shopId: shop.id,
        buyerEmail: { equals: own.email, mode: "insensitive" },
        invoiceType: { not: "CREDIT_NOTE" },
        OR: [{ buyerGstin: null }, { buyerGstin: { isSet: false } }],
      },
      select: { orderId: true },
      take: MAX_PAST_INVOICES,
    });
    let updated = 0, failed = 0;
    for (const inv of past) {
      try {
        if (await recalculateInvoice(admin, session.shop, shop.id, inv.orderId)) updated++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return json({
      success: true,
      message: past.length
        ? `Updated ${updated} past invoice(s) with this GSTIN${failed ? ` · ${failed} failed` : ""}`
        : "No earlier invoices without a GSTIN for this email",
    });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// ── Customer Form Modal ───────────────────────────────────────────────────────

type Customer = {
  id: string; companyName: string; gstin: string; email: string | null;
  phone: string | null; address: string | null; city: string | null;
  state: string | null; stateCode: string | null; pincode: string | null; notes: string | null;
  pendingApproval: boolean | null; invoiceCount: number;
};

const EMPTY_FORM = { companyName: "", gstin: "", email: "", phone: "", address: "", city: "", pincode: "", notes: "" };

function CustomerFormModal({
  editCustomer, gstinLookupEnabled, onClose,
}: {
  editCustomer: Customer | null; gstinLookupEnabled: boolean; onClose: (message?: string) => void;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const gstinFetcher = useFetcher<{
    businessName?: string | null; tradeName?: string | null; address?: string | null;
    city?: string | null; pincode?: string | null; fromApi?: boolean; error?: string;
  }>();
  const isLoading = fetcher.state !== "idle";

  const [form, setForm] = useState(() =>
    editCustomer
      ? {
          companyName: editCustomer.companyName, gstin: editCustomer.gstin, email: editCustomer.email || "",
          phone: editCustomer.phone || "", address: editCustomer.address || "", city: editCustomer.city || "",
          pincode: editCustomer.pincode || "", notes: editCustomer.notes || "",
        }
      : EMPTY_FORM
  );

  useEffect(() => {
    if (fetcher.data?.success) onClose(fetcher.data.message);
  }, [fetcher.data, onClose]);

  useEffect(() => {
    const d = gstinFetcher.data;
    if (!d || d.error) return;
    setForm((f) => ({
      ...f,
      ...(d.businessName ? { companyName: d.businessName } : {}),
      ...(d.address ? { address: d.address } : {}),
      ...(d.city ? { city: d.city } : {}),
      ...(d.pincode ? { pincode: d.pincode } : {}),
    }));
  }, [gstinFetcher.data]);

  const field = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));
  const gstinInvalid = form.gstin.length === 15 && !validateGstin(form.gstin);
  const gstinState = form.gstin.length >= 2 ? STATE_CODES[form.gstin.slice(0, 2)] : "";
  const emailInvalid = !!form.email && !EMAIL_RE.test(form.email);

  return (
    <Modal
      open
      onClose={() => onClose()}
      title={editCustomer ? "Edit B2B Customer" : "Add B2B Customer"}
      primaryAction={{
        content: editCustomer?.pendingApproval ? "Save & approve" : "Save",
        loading: isLoading,
        disabled: !form.companyName.trim() || form.gstin.length !== 15 || gstinInvalid || !form.email || emailInvalid,
        onAction: () => fetcher.submit({ intent: "save", ...(editCustomer ? { id: editCustomer.id } : {}), ...form }, { method: "POST" }),
      }}
      secondaryActions={[{ content: "Cancel", onAction: () => onClose() }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          {gstinFetcher.data?.fromApi && (
            <Banner tone="success">Business details filled from the GST registry. Please verify and save.</Banner>
          )}
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Registered business name" requiredIndicator
                value={form.companyName} onChange={field("companyName")} autoComplete="organization"
                helpText="As on the GST certificate — printed on the invoice."
              />
              <TextField
                label="GSTIN" requiredIndicator
                value={form.gstin}
                onChange={(v) => field("gstin")(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))}
                autoComplete="off"
                error={gstinInvalid ? "This GSTIN is not valid" : undefined}
                helpText={gstinState ? `State: ${gstinState}` : "15-character GST Identification Number"}
                connectedRight={
                  // Only useful with a GST registry API configured
                  gstinLookupEnabled ? (
                    <Button
                      onClick={() => gstinFetcher.load(`/api/gstin-lookup?gstin=${encodeURIComponent(form.gstin)}`)}
                      disabled={form.gstin.length !== 15 || gstinInvalid}
                      loading={gstinFetcher.state === "loading"}
                      size="slim"
                    >
                      Fetch
                    </Button>
                  ) : undefined
                }
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Email used for orders" requiredIndicator type="email"
                value={form.email} onChange={field("email")} autoComplete="email"
                error={emailInvalid ? "Enter a valid email" : undefined}
                helpText="Orders placed with this email get this GSTIN on the invoice."
              />
              <TextField label="Phone" type="tel" value={form.phone} onChange={field("phone")} autoComplete="tel" />
            </FormLayout.Group>
            <TextField label="Address" value={form.address} onChange={field("address")} autoComplete="street-address" multiline={2} />
            <FormLayout.Group>
              <TextField label="City" value={form.city} onChange={field("city")} autoComplete="address-level2" />
              <TextField
                label="Pincode" value={form.pincode} autoComplete="postal-code" inputMode="numeric"
                onChange={(v) => field("pincode")(v.replace(/\D/g, "").slice(0, 6))}
              />
            </FormLayout.Group>
            <TextField label="Notes" value={form.notes} onChange={field("notes")} autoComplete="off" multiline={2} />
          </FormLayout>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ── Row actions (own fetcher per row so each shows its own spinner) ───────────

function RowActions({
  customer, canUse, onEdit, onDelete, onDone,
}: {
  customer: Customer; canUse: boolean; onEdit: () => void; onDelete: () => void; onDone: (msg: string, error?: boolean) => void;
}) {
  const fetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const busy = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  useEffect(() => {
    if (fetcher.data?.message) onDone(fetcher.data.message);
    else if (fetcher.data?.error) onDone(fetcher.data.error, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const run = (intent: string) => fetcher.submit({ intent, id: customer.id }, { method: "POST" });

  return (
    <InlineStack gap="150" wrap={false}>
      {customer.pendingApproval ? (
        <Button size="slim" variant="primary" loading={busy === "approve"} onClick={canUse ? () => run("approve") : proPopup}>Approve</Button>
      ) : (
        <Button size="slim" loading={busy === "apply-past"} onClick={canUse ? () => run("apply-past") : proPopup}>Update past invoices</Button>
      )}
      <Button size="slim" onClick={canUse ? onEdit : proPopup}>Edit</Button>
      <Button size="slim" variant="plain" tone="critical" onClick={onDelete}>Delete</Button>
    </InlineStack>
  );
}

const proPopup = () =>
  openUpgradePopup({
    title: "B2B customers are a Pro feature",
    lines: [
      "Save your business buyers' GSTINs once — every order from their email then gets a proper B2B tax invoice with their GSTIN, so they can claim input tax credit.",
      "Upgrade to Pro to add, approve and edit B2B customers.",
    ],
  });

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { customers, pendingCount, search, shopDomain, tab, canUse, gstinLookupEnabled } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const deleteFetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();

  const [formCustomer, setFormCustomer] = useState<Customer | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);

  // Search updates the list as you type (after a short pause), no Search button needed
  const [searchValue, setSearchValue] = useState(search);
  useEffect(() => setSearchValue(search), [search]);
  useEffect(() => {
    if (searchValue.trim() === search) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams(searchParams);
      if (searchValue.trim()) p.set("q", searchValue.trim()); else p.delete("q");
      setSearchParams(p);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  useEffect(() => {
    if (deleteFetcher.data?.success) { setDeleteTarget(null); setToast({ msg: deleteFetcher.data.message || "Customer deleted" }); }
    else if (deleteFetcher.data?.error) setToast({ msg: deleteFetcher.data.error, error: true });
  }, [deleteFetcher.data]);

  const closeForm = useCallback((message?: string) => {
    setFormCustomer(null);
    if (message) setToast({ msg: message });
  }, []);

  const copyLink = () => {
    const url = `${window.location.origin}/collect-gstin/${encodeURIComponent(shopDomain)}`;
    navigator.clipboard.writeText(url).then(
      () => setToast({ msg: "Link copied! Share it with your B2B buyers." }),
      () => setToast({ msg: url })
    );
  };

  const tabs = [
    { id: "all", content: "All customers" },
    { id: "pending", content: pendingCount ? `Pending approval (${pendingCount})` : "Pending approval" },
  ];

  const rowMarkup = customers.map((c, i) => (
    <IndexTable.Row id={c.id} key={c.id} position={i}>
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Text as="span" variant="bodySm" fontWeight="semibold">{c.companyName}</Text>
          {c.pendingApproval && <Badge tone="attention">Pending approval</Badge>}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell><Text as="span" variant="bodySm">{c.gstin}</Text></IndexTable.Cell>
      <IndexTable.Cell><Text as="span" variant="bodySm">{c.email || "—"}</Text></IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell><Text as="span" variant="bodySm">{c.invoiceCount}</Text></IndexTable.Cell>
      <IndexTable.Cell>
        <RowActions
          customer={c}
          canUse={canUse}
          onEdit={() => setFormCustomer(c)}
          onDelete={() => setDeleteTarget(c)}
          onDone={(msg, error) => setToast({ msg, error })}
        />
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Frame>
      {toast && <Toast content={toast.msg} error={toast.error} onDismiss={() => setToast(null)} />}
      <Page
        title="B2B Customers"
        fullWidth
        primaryAction={{ content: "Add Customer", onAction: canUse ? () => setFormCustomer("new") : proPopup }}
        secondaryActions={[{ content: "Copy GSTIN Collection Link", onAction: copyLink }]}
      >
        <TitleBar title="B2B Customers" />
        <Layout>
          <Layout.Section>
            {canUse ? (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  Save your business buyers' GSTIN here — orders placed with their email get a B2B tax invoice with their GSTIN
                  and business name. Share the <strong>GSTIN Collection Link</strong> so buyers can submit details themselves;
                  you approve each one before it is used.
                </Text>
              </Banner>
            ) : (
              <Banner tone="warning" title="B2B customers — Pro feature" action={{ content: "Upgrade to Pro", url: "/app/billing" }}>
                <Text as="p" variant="bodySm">
                  Saved customers' GSTINs are added to invoices on the Pro plan. A GSTIN entered at checkout is always used.
                </Text>
              </Banner>
            )}
          </Layout.Section>
          <Layout.Section>
            <Card padding="0">
              <Tabs
                tabs={tabs}
                selected={tab === "pending" ? 1 : 0}
                onSelect={(i) => {
                  const p = new URLSearchParams(searchParams);
                  if (i === 1) p.set("tab", "pending"); else p.delete("tab");
                  setSearchParams(p);
                }}
              >
                <Box paddingInline="400" paddingBlock="300">
                  <TextField
                    label="" labelHidden
                    placeholder="Search by business name, GSTIN or email…"
                    value={searchValue}
                    onChange={setSearchValue}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearchValue("")}
                  />
                </Box>

                {customers.length === 0 ? (
                  <EmptyState
                    heading={tab === "pending" ? "No submissions waiting" : search ? "No customers match your search" : "No B2B customers yet"}
                    action={tab === "all" && !search ? { content: "Add Customer", onAction: canUse ? () => setFormCustomer("new") : proPopup } : undefined}
                    image=""
                  >
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tab === "pending"
                        ? "GST details submitted through your collection link will appear here for approval."
                        : "Add business buyers with their GSTIN to issue them proper B2B tax invoices."}
                    </Text>
                  </EmptyState>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "customer", plural: "customers" }}
                    itemCount={customers.length}
                    headings={[
                      { title: "Business name" },
                      { title: "GSTIN" },
                      { title: "Email" },
                      { title: "Location" },
                      { title: "Invoices" },
                      { title: "Actions" },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}
              </Tabs>
            </Card>
          </Layout.Section>
        </Layout>

        {formCustomer && (
          <CustomerFormModal
            key={formCustomer === "new" ? "new" : formCustomer.id}
            editCustomer={formCustomer === "new" ? null : formCustomer}
            gstinLookupEnabled={gstinLookupEnabled}
            onClose={closeForm}
          />
        )}

        {/* Polaris modal instead of window.confirm(), which Shopify admin's iframe can block */}
        <Modal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title="Delete B2B customer?"
          primaryAction={{
            content: "Delete",
            destructive: true,
            loading: deleteFetcher.state !== "idle",
            onAction: () => deleteTarget && deleteFetcher.submit({ intent: "delete", id: deleteTarget.id }, { method: "POST" }),
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
        >
          <Modal.Section>
            <Text as="p" variant="bodySm">
              {deleteTarget?.companyName} ({deleteTarget?.gstin}) will be removed. New orders from {deleteTarget?.email || "this customer"} will
              get B2C invoices. Invoices already created are not changed.
            </Text>
          </Modal.Section>
        </Modal>
      </Page>
    </Frame>
  );
}
