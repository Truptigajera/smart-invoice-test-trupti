import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { sendInvoiceEmail } from "~/lib/email.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_FULFILLED") {
    return new Response("Unhandled topic", { status: 400 });
  }

  const order = payload as { id: string; email?: string; billing_address?: { first_name?: string; last_name?: string } };

  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      include: { settings: true },
    });

    if (!shopRecord?.settings?.autoEmailEnabled) return new Response("OK", { status: 200 });
    if (shopRecord.settings.emailTrigger !== "fulfilled") return new Response("OK", { status: 200 });

    // Find invoice for this order
    const invoice = await prisma.invoice.findFirst({
      where: { shopId: shopRecord.id, orderId: String(order.id) },
      select: { id: true, invoiceNumber: true, pdfUrl: true, emailSentAt: true },
    });

    if (!invoice || invoice.emailSentAt || !invoice.pdfUrl || !order.email) {
      return new Response("OK", { status: 200 });
    }

    await sendInvoiceEmail({
      shopId: shopRecord.id,
      invoiceId: invoice.id,
      toEmail: order.email,
      toName: [order.billing_address?.first_name, order.billing_address?.last_name]
        .filter(Boolean).join(" ") || "Customer",
      invoiceNumber: invoice.invoiceNumber,
      pdfUrl: invoice.pdfUrl,
      subject: shopRecord.settings.emailSubject,
    });

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[webhook orders/fulfilled]", err);
    return new Response("Error", { status: 500 });
  }
};
