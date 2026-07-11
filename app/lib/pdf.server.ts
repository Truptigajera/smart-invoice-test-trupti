import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import type React from "react";
import QRCode from "qrcode";
import { join } from "path";
import { existsSync } from "fs";

// Resolve logo/signature for @react-pdf/renderer.
// Handles: base64 data URLs (stored in DB), absolute https URLs, legacy /logos/ file paths.
function resolvePublicImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:")) return url; // base64 data URL — pass directly
  const clean = url.split("?")[0]; // strip legacy cache-busting query params
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.startsWith("/")) {
    const abs = join(process.cwd(), "public", clean);
    return existsSync(abs) ? abs : null;
  }
  return null;
}
import { getInvoiceTemplate } from "~/components/invoice-templates";
import { PackingSlipPDFTemplate } from "~/components/PackingSlipPDFTemplate";
import { PackingSlipBoldTemplate } from "~/components/PackingSlipBoldTemplate";
import { PackingSlipOasisTemplate } from "~/components/PackingSlipOasisTemplate";
import { PackingSlipOrbixTemplate } from "~/components/PackingSlipOrbixTemplate";
import { CreditNotePDFTemplate } from "~/components/CreditNotePDFTemplate";
import { prisma } from "~/db.server";
import { mergeCustomization } from "~/lib/customization.types";

// Register NotoSans once at server startup — this is the only file that runs server-side only.
// NotoSans supports the ₹ glyph (U+20B9); built-in Helvetica/Times/Courier do not.
// If fonts are missing (e.g. first deploy), fall back gracefully — PDFs still generate, ₹ shows as ¹.
let _notoRegistered = false;
export let notoAvailable = false;
function ensureNotoSansRegistered(): void {
  if (_notoRegistered) return;
  _notoRegistered = true;
  const dir = join(process.cwd(), "public", "fonts");
  const regular = join(dir, "NotoSans-Regular.ttf");
  if (!existsSync(regular)) {
    console.warn("[pdf.server] NotoSans fonts not found — ₹ may render as ¹. Upload NotoSans TTF files to public/fonts/ to fix.");
    return;
  }
  Font.register({ family: "NotoSans",           src: regular });
  Font.register({ family: "NotoSans-Bold",       src: join(dir, "NotoSans-Bold.ttf") });
  Font.register({ family: "NotoSans-BoldItalic", src: join(dir, "NotoSans-BoldItalic.ttf") });
  notoAvailable = true;
}
ensureNotoSansRegistered();

// Pick packing slip template variant based on saved packingSlipTemplateId setting
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPackingSlipTemplate(packingSlipTemplateId: string): React.ComponentType<any> {
  switch (packingSlipTemplateId) {
    case "bold":  return PackingSlipBoldTemplate;
    case "oasis": return PackingSlipOasisTemplate;
    case "orbix": return PackingSlipOrbixTemplate;
    default:      return PackingSlipPDFTemplate;
  }
}

type CopyType = "Original" | "Duplicate" | "Triplicate";

export async function generateInvoicePDF(
  invoiceId: string,
  copyType: CopyType = "Original"
): Promise<Buffer> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: true,
      shop: { include: { settings: true } },
    },
  });

  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

  // Credit notes use dedicated template (not the invoice template)
  if (invoice.invoiceType === "CREDIT_NOTE") {
    const savedCustomization = await prisma.templateCustomization.findUnique({
      where: {
        shopId_templateId: {
          shopId: invoice.shopId,
          templateId: invoice.shop.settings?.templateId || "template-1",
        },
      },
    });
    const customization = mergeCustomization(savedCustomization);
    const cnInvoice = {
      ...invoice,
      shop: {
        ...invoice.shop,
        logoUrl: resolvePublicImage(invoice.shop.logoUrl),
        signatureUrl: resolvePublicImage(invoice.shop.signatureUrl),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = createElement(CreditNotePDFTemplate, { invoice: cnInvoice as any, customization }) as any;
    return renderToBuffer(el);
  }

  const templateId = invoice.shop.settings?.templateId || "template-1";
  const Template = getInvoiceTemplate(templateId);

  // Fetch per-template customization settings
  const savedCustomization = await prisma.templateCustomization.findUnique({
    where: { shopId_templateId: { shopId: invoice.shopId, templateId } },
  });
  const customization = mergeCustomization(savedCustomization);

  // Generate QR code image from NIC SignedQRCode (only when IRN is active)
  let qrCodeDataUrl: string | undefined;
  if (invoice.qrCode && invoice.irnStatus === "GENERATED") {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(invoice.qrCode, { width: 120, margin: 1, errorCorrectionLevel: "M" });
    } catch { /* skip if QR generation fails */ }
  }

  const resolvedInvoice = {
    ...invoice,
    qrCodeDataUrl,
    shop: {
      ...invoice.shop,
      logoUrl: resolvePublicImage(invoice.shop.logoUrl),
      signatureUrl: resolvePublicImage(invoice.shop.signatureUrl),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = createElement(Template, { invoice: resolvedInvoice as any, copyType, customization }) as any;
  const pdfBuffer = await renderToBuffer(el);

  return pdfBuffer;
}

// Save PDF locally — for Original copy only (updates invoice.pdfUrl)
export async function savePDF(invoiceId: string, buffer: Buffer): Promise<string> {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { existsSync } = await import("fs");

  const dir = join(process.cwd(), "public", "invoices");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const filename = `${invoiceId}.pdf`;
  const filepath = join(dir, filename);
  await writeFile(filepath, buffer);

  const url = `/invoices/${filename}`;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { pdfUrl: url, pdfGeneratedAt: new Date() },
  });

  return url;
}

export async function generateAndSavePDF(invoiceId: string): Promise<string> {
  const buffer = await generateInvoicePDF(invoiceId, "Original");
  return savePDF(invoiceId, buffer);
}

// Generate & save Packing Slip — saved as {invoiceId}-packing-slip.pdf
export async function generatePackingSlipPDF(invoiceId: string): Promise<string> {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { existsSync } = await import("fs");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, shop: { include: { settings: true } } },
  });
  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

  const invoiceTemplateId = invoice.shop.settings?.templateId || "template-1";
  const packingSlipTemplateId = invoice.shop.settings?.packingSlipTemplateId || "default";
  const SlipTemplate = getPackingSlipTemplate(packingSlipTemplateId);
  const savedCustomization = await prisma.templateCustomization.findUnique({
    where: { shopId_templateId: { shopId: invoice.shopId, templateId: invoiceTemplateId } },
  });
  const customization = mergeCustomization(savedCustomization);
  const slipInvoice = {
    ...invoice,
    shop: {
      ...invoice.shop,
      logoUrl: resolvePublicImage(invoice.shop.logoUrl),
      signatureUrl: resolvePublicImage(invoice.shop.signatureUrl),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = createElement(SlipTemplate, { invoice: slipInvoice as any, customization }) as any;
  const buffer = await renderToBuffer(el);

  const dir = join(process.cwd(), "public", "invoices");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const filename = `${invoiceId}-packing-slip.pdf`;
  await writeFile(join(dir, filename), buffer);
  return `/invoices/${filename}`;
}

// Generate Packing Slip buffer — no file write, returns Buffer directly
export async function generatePackingSlipBuffer(invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, shop: { include: { settings: true } } },
  });
  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);
  const invoiceTemplateId = invoice.shop.settings?.templateId || "template-1";
  const packingSlipTemplateId = invoice.shop.settings?.packingSlipTemplateId || "default";
  const SlipTemplate = getPackingSlipTemplate(packingSlipTemplateId);
  const savedCustomization = await prisma.templateCustomization.findUnique({
    where: { shopId_templateId: { shopId: invoice.shopId, templateId: invoiceTemplateId } },
  });
  const customization = mergeCustomization(savedCustomization);
  const slipInvoice2 = {
    ...invoice,
    shop: {
      ...invoice.shop,
      logoUrl: resolvePublicImage(invoice.shop.logoUrl),
      signatureUrl: resolvePublicImage(invoice.shop.signatureUrl),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = createElement(SlipTemplate, { invoice: slipInvoice2 as any, customization }) as any;
  return renderToBuffer(el);
}

// Generate Duplicate / Triplicate — saved separately, invoice.pdfUrl NOT updated
export async function generateCopyPDF(
  invoiceId: string,
  copyType: CopyType
): Promise<string> {
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");
  const { existsSync } = await import("fs");

  const buffer = await generateInvoicePDF(invoiceId, copyType);

  const dir = join(process.cwd(), "public", "invoices");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const filename = `${invoiceId}-${copyType.toLowerCase()}.pdf`;
  const filepath = join(dir, filename);
  await writeFile(filepath, buffer);

  return `/invoices/${filename}`;
}
