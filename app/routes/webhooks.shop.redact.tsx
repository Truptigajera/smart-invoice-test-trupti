import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

// GDPR compliance: shop requests all their data be redacted/deleted
// Triggered 48 hours after app uninstall. We delete shop PII but keep
// anonymised invoice records per GST law if needed, or delete all.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`GDPR shop/redact: shop=${shop} topic=${topic}`);

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) return new Response("OK", { status: 200 });

  // Delete all shop data (sessions already deleted on uninstall)
  await prisma.emailLog.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.reportHistory.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.templateCustomization.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.shopLocation.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { shopId: shopRecord.id } } });
  await prisma.invoice.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.shopSettings.deleteMany({ where: { shopId: shopRecord.id } });
  await prisma.shop.delete({ where: { id: shopRecord.id } });

  return new Response("OK", { status: 200 });
};
