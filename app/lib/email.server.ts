import { Resend } from "resend";
import { prisma } from "~/db.server";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DEFAULT = process.env.EMAIL_FROM || "invoices@gstinvoicepro.com";

export interface SendInvoiceEmailArgs {
  shopId: string;
  invoiceId: string;
  toEmail: string;
  toName: string;
  invoiceNumber: string;
  pdfBuffer?: Buffer;   // generated on-the-fly — preferred
  pdfUrl?: string;      // legacy / fallback for download link in email body
  subject?: string;
}

export async function sendInvoiceEmail({
  shopId,
  invoiceId,
  toEmail,
  toName,
  invoiceNumber,
  pdfBuffer,
  pdfUrl,
  subject,
}: SendInvoiceEmailArgs): Promise<void> {
  const settings = await prisma.shopSettings.findUnique({ where: { shopId } });
  const emailSubject = (subject || settings?.emailSubject || "Your GST Invoice {invoice_number}")
    .replace("{invoice_number}", invoiceNumber);
  const emailBody = settings?.emailBody || null;

  const appUrl = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const fullPdfUrl = pdfUrl
    ? (pdfUrl.startsWith("http") ? pdfUrl : `${appUrl}${pdfUrl}`)
    : `${appUrl}/invoice/pdf/${invoiceId}`;

  const isTest = invoiceId === "test";
  const log = isTest ? null : await prisma.emailLog.create({
    data: { shopId, invoiceId, sentTo: toEmail, subject: emailSubject, status: "pending" },
  });

  try {
    // Use SMTP via nodemailer if configured, otherwise use Resend
    if (settings?.smtpEnabled && settings.smtpHost && settings.smtpUser) {
      await sendViaSMTP({
        settings: settings as { smtpHost: string; smtpPort: number | null; smtpUser: string; smtpPass: string | null; smtpFrom: string | null },
        toEmail,
        subject: emailSubject,
        html: buildEmailHtml(toName, invoiceNumber, fullPdfUrl, emailBody),
        pdfBuffer: pdfBuffer ?? null,
        invoiceNumber,
      });
    } else {
      const attachments: Array<{ filename: string; content: string }> = pdfBuffer
        ? [{ filename: `Invoice-${invoiceNumber}.pdf`, content: pdfBuffer.toString("base64") }]
        : [];

      await resend.emails.send({
        from: FROM_DEFAULT,
        to: toEmail,
        reply_to: "support@viradiyainfotech.com",
        subject: emailSubject,
        html: buildEmailHtml(toName, invoiceNumber, fullPdfUrl, emailBody),
        text: buildEmailText(toName, invoiceNumber, fullPdfUrl, emailBody),
        attachments,
        headers: {
          "List-Unsubscribe": "<mailto:support@viradiyainfotech.com?subject=unsubscribe>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-Entity-Ref-ID": invoiceId,
        },
      } as Parameters<typeof resend.emails.send>[0]);
    }

    if (log) {
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: "sent", sentAt: new Date() } });
      await prisma.invoice.update({ where: { id: invoiceId }, data: { emailSentAt: new Date() } });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "failed", errorMsg: msg } });
    throw err;
  }
}

async function sendViaSMTP({
  settings, toEmail, subject, html, pdfBuffer, invoiceNumber,
}: {
  settings: { smtpHost: string; smtpPort: number | null; smtpUser: string; smtpPass: string | null; smtpFrom: string | null };
  toEmail: string; subject: string; html: string;
  pdfBuffer: Buffer | null; invoiceNumber: string;
}) {
  const nodemailer = await import("nodemailer");
  const port = settings.smtpPort || 587;
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port,
    secure: port === 465,
    auth: { user: settings.smtpUser, pass: settings.smtpPass || "" },
  });

  const mailOptions: Record<string, unknown> = {
    from: settings.smtpFrom || settings.smtpUser,
    to: toEmail,
    subject,
    html,
  };

  if (pdfBuffer) {
    mailOptions.attachments = [{
      filename: `Invoice-${invoiceNumber}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    }];
  }

  await transporter.sendMail(mailOptions);
}

function buildEmailText(name: string, invoiceNumber: string, pdfUrl: string, customBody: string | null): string {
  const body = customBody
    ? customBody.replace("{customer_name}", name).replace("{invoice_number}", invoiceNumber)
    : `Dear ${name},\n\nThank you for your order. Please find your GST invoice ${invoiceNumber} attached to this email.\n\nYou can also download it here:\n${pdfUrl}\n\nFor any queries, reply to this email or contact us at support@viradiyainfotech.com.`;
  return body;
}

function buildEmailHtml(name: string, invoiceNumber: string, pdfUrl: string, customBody: string | null): string {
  const bodyParagraphs = customBody
    ? customBody
        .replace("{customer_name}", name)
        .replace("{invoice_number}", invoiceNumber)
        .split("\n")
        .map((l) => `<p>${l}</p>`)
        .join("")
    : `<p>Dear ${name},</p><p>Thank you for your order. Please find your GST invoice <strong>${invoiceNumber}</strong> attached below.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e0e0e0;max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:#1a73e8;border-radius:8px 8px 0 0;padding:20px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">GST Invoice — ${invoiceNumber}</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${bodyParagraphs}
            <p style="margin:8px 0 0;">The invoice PDF is attached to this email. You can also download it using the link below.</p>
            <p style="margin:28px 0;">
              <a href="${pdfUrl}" style="background:#1a73e8;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block;">
                Download Invoice PDF
              </a>
            </p>
            <p style="margin:0;color:#555;font-size:13px;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${pdfUrl}" style="color:#1a73e8;word-break:break-all;">${pdfUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid #e0e0e0;padding:20px 32px;">
            <p style="margin:0;color:#888;font-size:12px;">
              Questions? Reply to this email or write to <a href="mailto:support@viradiyainfotech.com" style="color:#1a73e8;">support@viradiyainfotech.com</a><br>
              To stop receiving invoice emails, <a href="mailto:support@viradiyainfotech.com?subject=unsubscribe" style="color:#888;">unsubscribe here</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
