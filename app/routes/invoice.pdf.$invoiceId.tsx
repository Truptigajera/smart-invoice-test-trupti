import type { LoaderFunctionArgs } from "@remix-run/node";
import { generateInvoicePDF } from "~/lib/pdf.server";
import { prisma } from "~/db.server";

// Public route — no Shopify auth required
// Used as the "Download Invoice" button link in customer emails
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { invoiceId } = params;
  if (!invoiceId) throw new Response("Not found", { status: 404 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true },
  });
  if (!invoice) throw new Response("Invoice not found", { status: 404 });

  const pdfBuffer = await generateInvoicePDF(invoiceId, "Original");
  const safeName = invoice.invoiceNumber.replace(/[/\\:*?"<>|]/g, "-");

  return new Response(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice-${safeName}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
};
