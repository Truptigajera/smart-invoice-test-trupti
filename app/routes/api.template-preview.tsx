import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { renderLiquidTemplate, invoiceToScope } from "~/lib/liquid.server";
import type { InvoiceData } from "~/components/invoice-pdf-types";

// POST /api/template-preview
// Body: { templateCode: string, invoiceId?: string }
// Returns: rendered HTML string
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return new Response("Shop not found", { status: 404 });

  const { templateCode, invoiceId } = await request.json();

  const invoice = await prisma.invoice.findFirst({
    where: {
      shopId: shop.id,
      invoiceType: { not: "CREDIT_NOTE" },
      ...(invoiceId ? { id: invoiceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { lineItems: true, shop: { include: { settings: true } } },
  });

  if (!invoice) {
    const fallbackHtml = await renderLiquidTemplate(templateCode, {
      shop: { name: "Your Business", gstin: "22AAAAA0000A1Z5", address: "123 Main St", city: "Mumbai", state: "Maharashtra", pincode: "400001", country: "India", phone: "+91 9999999999", email: "hello@example.com", logoUrl: "", signatureUrl: "", footerText: "Thank you for your business!" },
      invoice: { number: "INV-001", date: new Date().toISOString(), dateFormatted: "15 May 2026", type: "TAX_INVOICE", copyType: "Original", supplyType: "B2B", taxType: "IGST", isIGST: true, placeOfSupply: "Gujarat", reverseCharge: false, amountInWords: "Eight Hundred Eighty Four Rupees Only", orderName: "#1001" },
      buyer: { name: "Sample Customer", company: "", address: "456 Park Ave", city: "Surat", state: "Gujarat", pincode: "395007", country: "India", phone: "+91 8888888888", email: "customer@example.com", gstin: "" },
      shipping: { name: "Sample Customer", address: "456 Park Ave", city: "Surat", state: "Gujarat", pincode: "395007", country: "India", phone: "+91 8888888888" },
      lineItems: [{ index: 1, name: "Sample Product", variantName: "", sku: "SKU-001", hsn: "6108", quantity: 1, unit: "Nos", unitPrice: 749.95, taxable: 749.95, gstPct: 18, cgstRate: 0, cgstAmt: 0, sgstRate: 0, sgstAmt: 0, igstRate: 18, igstAmt: 134.99, total: 884.94 }],
      totals: { subtotal: 749.95, discount: 0, taxable: 749.95, cgst: 0, sgst: 0, igst: 134.99, tax: 134.99, shipping: 0, shippingTax: 0, grandTotal: 884.94, totalRefunded: 0, outstanding: 0 },
      settings: { dateFormat: "", currencyFormat: "₹ {{amount}}", showHsn: true, shippingHsn: "996812" },
    });
    return new Response(fallbackHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const scope = invoiceToScope(invoice as unknown as InvoiceData, "Original");
  const html = await renderLiquidTemplate(templateCode, scope, invoice.shop.settings as any);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
