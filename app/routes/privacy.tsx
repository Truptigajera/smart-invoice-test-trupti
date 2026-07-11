import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — InvoiceGST — Smart GST Invoicing" },
];

export default function PrivacyPolicy() {
  return (
    <div style={{ fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "0 auto", padding: "40px 24px", color: "#333", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        <strong>InvoiceGST — Smart GST Invoicing</strong> &nbsp;·&nbsp; Last updated: May 2026
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>1. Data We Collect</h2>
        <p>We collect and store the following data when you install and use InvoiceGST:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Shop domain, business name, GSTIN, address, phone, email</li>
          <li>Order data (order number, buyer name, shipping address, line items, tax amounts)</li>
          <li>Invoice records generated from your orders</li>
          <li>Email logs (when invoices are sent via email)</li>
          <li>App settings and preferences (template, colors, font, footer text, etc.)</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>2. How We Use Your Data</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>Generate GST-compliant invoice PDFs (Tax Invoice, Credit Note, Bill of Supply)</li>
          <li>Send invoices to customers via email</li>
          <li>Generate GST reports (GSTR-1, GSTR-3B, HSN Summary)</li>
          <li>E-Invoice (IRN) generation via NIC IRP (for eligible merchants)</li>
          <li>Display invoice history and analytics within the app</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>3. Data Retention</h2>
        <p>
          Invoice and tax records are retained for a minimum of <strong>72 months (6 years)</strong> as
          required by the Goods and Services Tax Act, 2017 (India). You may request deletion of your
          personal information, but financial records required by law cannot be deleted before the
          statutory retention period expires.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>4. Data Sharing</h2>
        <p>We do <strong>not</strong> sell, rent, or share your data with third parties, except:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>NIC IRP (Government of India)</strong> — for E-Invoice IRN generation only (when enabled)</li>
          <li><strong>SMTP email provider</strong> — for sending invoice emails to your customers</li>
          <li><strong>Shopify</strong> — as required by the Shopify Partner Agreement</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>5. Security</h2>
        <p>
          All data is stored on secure servers. E-Invoice API credentials (Client ID, Client Secret,
          API Username, API Password) are stored encrypted in our database. Invoice PDFs are generated
          on-demand and not permanently stored on our servers.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>6. Your Rights (GDPR)</h2>
        <p>
          If you are subject to GDPR, you have the right to access, correct, or delete your personal data.
          To make a request, contact us at the email below. Please note that invoice data required by
          Indian tax law cannot be deleted during the statutory retention period.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>7. Uninstalling the App</h2>
        <p>
          When you uninstall InvoiceGST, your Shopify session data is immediately deleted. Your invoice
          and shop records are retained for the statutory period (72 months) as required by GST law,
          then permanently deleted. You can request earlier deletion by contacting us.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>8. Contact</h2>
        <p>
          For any privacy-related questions or data requests, please contact:<br />
          <strong>Email:</strong> support@engees.in<br />
          <strong>Website:</strong> https://engees.in
        </p>
      </section>

      <hr style={{ border: "none", borderTop: "1px solid #e0e0e0", marginTop: 40, marginBottom: 24 }} />
      <p style={{ fontSize: 13, color: "#999" }}>
        InvoiceGST — Smart GST Invoicing is developed by Engees. This policy applies to the Shopify app
        available at the Shopify App Store.
      </p>
    </div>
  );
}
