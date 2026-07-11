import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { generateInvoiceNumber } from "~/lib/invoice-number.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);

  const refund = payload as {
    id: string;
    order_id: string;
    refund_line_items: Array<{ quantity: number; line_item: { title: string; price: string } }>;
    transactions: Array<{ amount: string }>;
  };

  try {
    const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    if (!shopRecord) return new Response("Shop not found", { status: 404 });

    // Find original invoice
    const originalInvoice = await prisma.invoice.findFirst({
      where: { shopId: shopRecord.id, orderId: String(refund.order_id) },
    });

    const creditNoteNumber = await generateInvoiceNumber(shopRecord.id);
    const refundTotal = refund.transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    await prisma.invoice.create({
      data: {
        shopId: shopRecord.id,
        orderId: String(refund.order_id),
        invoiceNumber: creditNoteNumber,
        invoiceType: "CREDIT_NOTE",
        supplyType: originalInvoice?.supplyType || "B2C",
        taxType: originalInvoice?.taxType || "IGST",
        buyerName: originalInvoice?.buyerName,
        buyerEmail: originalInvoice?.buyerEmail,
        buyerGstin: originalInvoice?.buyerGstin,
        buyerState: originalInvoice?.buyerState,
        buyerStateCode: originalInvoice?.buyerStateCode,
        totalAmount: -refundTotal,
        amountInWords: `Credit Note for Refund`,
        lineItems: {
          create: refund.refund_line_items.map((item) => ({
            productName: item.line_item.title,
            quantity: -item.quantity,
            unitPrice: parseFloat(item.line_item.price),
            taxableValue: -item.quantity * parseFloat(item.line_item.price),
            totalAmount: -item.quantity * parseFloat(item.line_item.price),
          })),
        },
      },
    });

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[webhook refunds/create]", err);
    return new Response("Error", { status: 500 });
  }
};
