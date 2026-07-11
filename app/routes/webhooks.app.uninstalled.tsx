import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);

  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  // Keep invoice data per GST compliance (72 months retention)
  // Just reset plan to free, do not delete shop/invoice records
  await prisma.shop.updateMany({
    where: { shopDomain: shop },
    data: { currentPlan: "free" },
  });

  return new Response("OK", { status: 200 });
};
