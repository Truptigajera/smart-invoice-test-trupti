import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// GDPR compliance: customer requests their data
// GST invoices are legal records — we acknowledge the request but data
// cannot be deleted per Indian tax law (72-month retention mandate).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`GDPR data_request: shop=${shop} topic=${topic}`);
  // payload.customer.id, payload.customer.email available if needed

  return new Response("OK", { status: 200 });
};
