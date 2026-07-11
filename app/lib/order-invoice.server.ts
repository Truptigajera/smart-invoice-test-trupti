import { prisma } from "~/db.server";
import { createInvoiceFromOrder } from "~/lib/invoice.server";

export const SINGLE_ORDER_QUERY = `
  query getOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email
      phone
      billingAddress {
        firstName
        lastName
        address1
        city
        province
        provinceCode
        zip
        country
      }
      taxesIncluded
      note
      tags
      paymentGatewayNames
      lineItems(first: 50) {
        edges {
          node {
            title
            variantTitle
            quantity
            originalUnitPriceSet { shopMoney { amount } }
            discountedTotalSet { shopMoney { amount } }
            taxLines { rate priceSet { shopMoney { amount } } title }
            discountAllocations { allocatedAmountSet { shopMoney { amount } } }
            customAttributes { key value }
            product {
              metafields(namespace: "gst_invoice", first: 5) {
                edges { node { key value } }
              }
            }
          }
        }
      }
      totalPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      shippingLines(first: 5) {
        edges {
          node {
            originalPriceSet { shopMoney { amount } }
            taxLines { rate priceSet { shopMoney { amount } } }
          }
        }
      }
      customAttributes { key value }
    }
  }
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWebhookShape(numericOrderId: string, gqlOrder: any) {
  return {
    id: numericOrderId,
    name: gqlOrder.name,
    email: gqlOrder.email || "",
    phone: gqlOrder.phone || "",
    taxes_included: gqlOrder.taxesIncluded ?? true,
    note: gqlOrder.note || "",
    payment_gateway: (gqlOrder.paymentGatewayNames as string[] | null)?.join(", ") || "",
    tags: Array.isArray(gqlOrder.tags) ? gqlOrder.tags.join(",") : (gqlOrder.tags || ""),
    billing_address: gqlOrder.billingAddress
      ? {
          first_name: gqlOrder.billingAddress.firstName || "",
          last_name: gqlOrder.billingAddress.lastName || "",
          address1: gqlOrder.billingAddress.address1 || "",
          city: gqlOrder.billingAddress.city || "",
          province: gqlOrder.billingAddress.province || "",
          province_code: gqlOrder.billingAddress.provinceCode || "",
          zip: gqlOrder.billingAddress.zip || "",
          country: gqlOrder.billingAddress.country || "",
        }
      : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    line_items: (gqlOrder.lineItems?.edges || []).map((e: any) => {
      const props = (e.node.customAttributes || []).map((a: { key: string; value: string }) => ({
        name: a.key,
        value: a.value,
      }));
      const metafields = e.node.product?.metafields?.edges || [];
      const hsnMeta = metafields.find((m: { node: { key: string } }) => m.node.key === "hsn_code");
      const gstRateMeta = metafields.find((m: { node: { key: string } }) => m.node.key === "gst_rate");
      let finalProps = hsnMeta
        ? [...props.filter((p: { name: string }) => !p.name.toLowerCase().includes("hsn")), { name: "hsn_code", value: hsnMeta.node.value }]
        : props;
      if (gstRateMeta) {
        finalProps = [...finalProps.filter((p: { name: string }) => p.name !== "metafield_gst_rate"), { name: "metafield_gst_rate", value: gstRateMeta.node.value }];
      }
      return {
        title: e.node.title,
        variant_title: e.node.variantTitle || "",
        quantity: e.node.quantity,
        price: e.node.originalUnitPriceSet.shopMoney.amount,
        total_discount: (() => {
          // Use discountedTotalSet (most reliable) — covers discount codes, automatic discounts, manual adjustments
          const originalTotal = parseFloat(e.node.originalUnitPriceSet.shopMoney.amount) * e.node.quantity;
          const discountedTotal = parseFloat(e.node.discountedTotalSet?.shopMoney?.amount ?? String(originalTotal));
          const diff = Math.round((originalTotal - discountedTotal) * 100) / 100;
          if (diff > 0) return diff.toFixed(2);
          // Fallback to discountAllocations sum
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (e.node.discountAllocations || []).reduce((sum: number, d: any) => sum + parseFloat(d.allocatedAmountSet.shopMoney.amount), 0).toFixed(2);
        })(),
        tax_lines: (e.node.taxLines || []).map((t: { rate: number; priceSet: { shopMoney: { amount: string } }; title: string }) => ({
          rate: t.rate,
          price: t.priceSet.shopMoney.amount,
          title: t.title,
        })),
        properties: finalProps,
      };
    }),
    total_price: gqlOrder.totalPriceSet.shopMoney.amount,
    total_tax: gqlOrder.totalTaxSet.shopMoney.amount,
    total_discounts: gqlOrder.totalDiscountsSet.shopMoney.amount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shipping_lines: (gqlOrder.shippingLines?.edges || []).map((e: any) => ({
      price: e.node.originalPriceSet.shopMoney.amount,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tax_lines: (e.node.taxLines || []).map((t: any) => ({
        rate: t.rate,
        price: t.priceSet.shopMoney.amount,
      })),
    })),
    note_attributes: (gqlOrder.customAttributes || []).map((a: { key: string; value: string }) => ({
      name: a.key,
      value: a.value,
    })),
  };
}

// Returns invoice ID — creates one from Shopify if not in DB yet
export async function ensureInvoiceExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shopDomain: string,
  shopId: string,
  numericOrderId: string
): Promise<string | null> {
  const existing = await prisma.invoice.findFirst({
    where: { shopId, orderId: numericOrderId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const gid = `gid://shopify/Order/${numericOrderId}`;
  const res = await admin.graphql(SINGLE_ORDER_QUERY, { variables: { id: gid } });
  const orderData = await res.json();
  const gqlOrder = orderData.data?.order;
  if (!gqlOrder) return null;

  const webhookShape = buildWebhookShape(numericOrderId, gqlOrder);
  return createInvoiceFromOrder(shopDomain, webhookShape);
}
