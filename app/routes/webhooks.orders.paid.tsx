import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { createInvoiceFromOrder } from "~/lib/invoice.server";
import { generateAndSavePDF } from "~/lib/pdf.server";
import { prisma } from "~/db.server";
import { sendInvoiceEmail } from "~/lib/email.server";
import { isOverLimit, PlanLimitError } from "~/lib/plan-limits.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 400 });
  }

  const order = payload as Parameters<typeof createInvoiceFromOrder>[1];

  try {
    // Check plan limit before creating invoice
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      include: { settings: true },
    });
    if (!shopRecord) return new Response("Shop not found", { status: 404 });

    const over = await isOverLimit(shopRecord.id, shopRecord.currentPlan);
    if (over) {
      console.warn(`[webhook orders/paid] Shop ${shop} over plan limit — skipping invoice`);
      return new Response("Plan limit reached", { status: 200 });
    }

    // createInvoiceFromOrder counts the order toward the monthly limit (only when a new invoice is created)
    const invoiceId = await createInvoiceFromOrder(shop, order);

    // Generate PDF immediately after invoice creation
    await generateAndSavePDF(invoiceId);

    // Auto-send email if trigger is "paid"
    if (!shopRecord?.settings?.autoEmailEnabled) {
      console.log(`[email] skipped — autoEmail disabled for shop ${shop}`);
    } else if (shopRecord.settings.emailTrigger !== "paid") {
      console.log(`[email] skipped — trigger is "${shopRecord.settings.emailTrigger}", not "paid"`);
    } else if (!order.email) {
      console.log(`[email] skipped — order has no email (order ${order.name})`);
    } else {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { invoiceNumber: true },
      });
      if (invoice) {
        try {
          const { generateInvoicePDF } = await import("~/lib/pdf.server");
          const pdfBuffer = await generateInvoicePDF(invoiceId, "Original");
          const appUrl = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
          console.log(`[email] sending to ${order.email} for invoice ${invoice.invoiceNumber}`);
          await sendInvoiceEmail({
            shopId: shopRecord.id,
            invoiceId,
            toEmail: order.email,
            toName: [order.billing_address?.first_name, order.billing_address?.last_name]
              .filter(Boolean).join(" ") || "Customer",
            invoiceNumber: invoice.invoiceNumber,
            pdfBuffer,
            pdfUrl: `${appUrl}/invoice/pdf/${invoiceId}`,
            subject: shopRecord.settings.emailSubject,
          });
          console.log(`[email] sent successfully to ${order.email}`);
        } catch (emailErr) {
          console.error(`[email] FAILED to send to ${order.email}:`, emailErr);
        }
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    // Limit reached between the check above and creation — not a failure, so don't make Shopify retry
    if (err instanceof PlanLimitError) {
      console.warn(`[webhook orders/paid] Shop ${shop} over plan limit — skipping invoice`);
      return new Response("Plan limit reached", { status: 200 });
    }
    console.error("[webhook orders/paid]", err);
    return new Response("Error processing webhook", { status: 500 });
  }
};
