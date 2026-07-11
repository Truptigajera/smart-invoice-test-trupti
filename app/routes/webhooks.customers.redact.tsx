import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

// GDPR compliance: merchant requests customer data redaction
// We redact PII from invoice buyer fields while keeping financial records
// as required by Indian GST law (72-month retention).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`GDPR customers/redact: shop=${shop} topic=${topic}`);

  const customerEmail = String(payload?.customer?.email ?? "");
  if (!customerEmail) return new Response("OK", { status: 200 });

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) return new Response("OK", { status: 200 });

  // Redact buyer PII — keep tax amounts for GST compliance
  await prisma.invoice.updateMany({
    where: { shopId: shopRecord.id, buyerEmail: customerEmail },
    data: {
      buyerName:    "[Redacted]",
      buyerEmail:   null,
      buyerPhone:   null,
      buyerAddress: null,
    },
  });

  return new Response("OK", { status: 200 });
};
