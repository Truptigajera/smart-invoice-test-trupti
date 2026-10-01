import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  Button, Divider, Box, Grid, Banner, Thumbnail,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { getOrderLimit } from "~/lib/plan-limits.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });

  if (!shop || !shop.onboardingDone) {
    const url = new URL(request.url);
    return redirect(`/app/onboarding?${url.searchParams.toString()}`);
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalInvoices, monthInvoices, pendingEmails, recentInvoices] =
    await Promise.all([
      prisma.invoice.count({ where: { shopId: shop.id } }),
      prisma.invoice.count({
        where: { shopId: shop.id, createdAt: { gte: startOfMonth } },
      }),
      prisma.invoice.count({
        where: {
          shopId: shop.id,
          createdAt: { gte: startOfMonth },
          // MongoDB: optional fields may be missing entirely, not just null
          OR: [{ emailSentAt: null }, { emailSentAt: { isSet: false } }],
        },
      }),
      prisma.invoice.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, invoiceNumber: true, buyerName: true,
          totalAmount: true, createdAt: true, emailSentAt: true,
          taxType: true, orderId: true,
        },
      }),
    ]);

  // Fetch products with missing HSN code
  let missingHsnProducts: { id: string; title: string; image: string | null }[] = [];
  try {
    const response = await admin.graphql(`
      query {
        products(first: 20) {
          edges {
            node {
              id
              title
              images(first: 1) { edges { node { url } } }
              metafields(namespace: "gst_invoice", first: 2) {
                edges { node { key value } }
              }
            }
          }
        }
      }
    `);
    const data = await response.json();
    const allProducts = data.data?.products?.edges || [];
    missingHsnProducts = allProducts
      .filter((edge: any) => {
        const mf = edge.node.metafields?.edges || [];
        const hsn = mf.find((m: any) => m.node.key === "hsn_code");
        return !hsn || !hsn.node.value;
      })
      .slice(0, 5)
      .map((edge: any) => ({
        id: edge.node.id.split("/").pop(),
        title: edge.node.title,
        image: edge.node.images?.edges?.[0]?.node?.url || null,
      }));
  } catch (e) {
    // ignore if products query fails
  }

  // Same limit table the orders/paid webhook enforces — keyed by the real Shopify plan name
  const planLimit = getOrderLimit(shop.currentPlan, shop.freeInvoiceLimit);
  // The counter only resets when the next order arrives, so a count from a previous month is really 0
  const reset = shop.planResetDate ? new Date(shop.planResetDate) : null;
  const countIsThisMonth = !!reset && reset.getMonth() === now.getMonth() && reset.getFullYear() === now.getFullYear();
  const ordersThisMonth = countIsThisMonth ? shop.ordersThisMonth : 0;
  const usagePercent = planLimit === null ? 0 : Math.round((ordersThisMonth / planLimit) * 100);

  return json({
    shop: {
      businessName: shop.businessName,
      gstin: shop.gstin,
      currentPlan: shop.currentPlan,
      ordersThisMonth,
      planLimit: planLimit === null ? "Unlimited" : planLimit,
      usagePercent,
    },
    stats: { totalInvoices, monthInvoices, pendingEmails },
    recentInvoices,
    missingHsnProducts,
  });
};

export default function Dashboard() {
  const { shop, stats, recentInvoices, missingHsnProducts } = useLoaderData<typeof loader>();

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const formatAmount = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

  return (
    <Page>
      <TitleBar title="GST Invoice Pro — Dashboard" />
      <BlockStack gap="500">

        {typeof shop.planLimit === "number" && shop.ordersThisMonth >= shop.planLimit && (
          <Banner
            title={`Free plan limit reached — ${shop.planLimit} invoices this month`}
            tone="critical"
            action={{ content: "Upgrade plan", url: "/app/billing" }}
          >
            <Text as="p" variant="bodySm">
              New orders won't get GST invoices until you upgrade or the month resets.
            </Text>
          </Banner>
        )}

        {/* Welcome + Plan */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingSm">
                      Welcome back{shop.businessName ? `, ${shop.businessName}` : ""}!
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      GSTIN: {shop.gstin || "Not configured"}
                    </Text>
                  </BlockStack>
                  <Badge tone={shop.currentPlan === "free" ? "info" : "success"}>
                    {`${shop.currentPlan.charAt(0).toUpperCase()}${shop.currentPlan.slice(1)} Plan`}
                  </Badge>
                </InlineStack>
                <Divider />
                <InlineStack gap="200" align="space-between">
                  <Text as="p" variant="bodySm">
                    Invoices this month: <strong>{shop.ordersThisMonth}</strong> / {shop.planLimit}
                  </Text>
                  {shop.currentPlan === "free" && (
                    <Link to="/app/billing">
                      <Button variant="primary" size="slim">Upgrade Plan</Button>
                    </Link>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Stats Cards */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 2, lg: 4, xl: 4 }}>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Total Invoices</Text>
                <Text as="p" variant="headingMd">{stats.totalInvoices}</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 2, lg: 4, xl: 4 }}>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">This Month</Text>
                <Text as="p" variant="headingMd">{stats.monthInvoices}</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 2, lg: 4, xl: 4 }}>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Email Pending</Text>
                <Text as="p" variant="headingMd">{stats.pendingEmails}</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* Missing HSN Warning */}
        {missingHsnProducts.length > 0 && (
          <Banner
            title={`${missingHsnProducts.length} product${missingHsnProducts.length > 1 ? "s" : ""} missing HSN code or GST rate`}
            tone="warning"
            action={{ content: "Fix Now", url: "/app/products" }}
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                GST invoices may be incorrect without HSN codes. Set them in Products & HSN.
              </Text>
              <BlockStack gap="100">
                {missingHsnProducts.map((p) => (
                  <InlineStack key={p.id} gap="200" blockAlign="center">
                    {p.image ? (
                      <Thumbnail source={p.image} alt={p.title} size="extraSmall" />
                    ) : (
                      <Box width="24px" minHeight="24px" background="bg-surface-secondary" borderRadius="100" />
                    )}
                    <Text as="span" variant="bodySm">{p.title}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Banner>
        )}

        {/* Recent Invoices */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingXs">Recent Invoices</Text>
              <Button url="/app/invoices" variant="plain">View All</Button>
            </InlineStack>

            {recentInvoices.length === 0 ? (
              <Box paddingBlock="400">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  No invoices yet. Invoices will appear here once orders are placed.
                </Text>
              </Box>
            ) : (
              <BlockStack gap="300">
                {recentInvoices.map((inv) => (
                  <Box key={inv.id} paddingBlock="200" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Link to={`/app/invoices/${inv.id}`}>
                          <Text as="span" variant="bodySm" fontWeight="semibold">{inv.invoiceNumber}</Text>
                        </Link>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {inv.buyerName || "Guest"} · {formatDate(inv.createdAt)}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={inv.taxType === "IGST" ? "attention" : "info"}>
                          {inv.taxType === "IGST" ? "IGST" : "CGST+SGST"}
                        </Badge>
                        {inv.emailSentAt ? (
                          <Badge tone="success">Email Sent</Badge>
                        ) : (
                          <Badge>Email Pending</Badge>
                        )}
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {formatAmount(inv.totalAmount)}
                        </Text>
                        <Link to={`/app/print/${inv.orderId}`}>
                          <Button size="slim" variant="secondary">Print</Button>
                        </Link>
                        <Link to={`/app/invoices/${inv.id}`}>
                          <Button size="slim" variant="secondary">PDF</Button>
                        </Link>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Quick Actions */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingXs">Quick Actions</Text>
            <InlineStack gap="300">
              <Button url="/app/invoices" variant="secondary" size="slim">View All Invoices</Button>
              <Button url="/app/reports" variant="secondary" size="slim">Download GST Reports</Button>
              <Button url="/app/settings" variant="secondary" size="slim">Configure Settings</Button>
              <Button url="/app/customize" variant="secondary" size="slim">Customize Invoice</Button>
            </InlineStack>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
