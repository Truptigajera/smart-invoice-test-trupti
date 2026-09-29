import type { MetaFunction } from "@remix-run/node";
import { useState } from "react";

export const meta: MetaFunction = () => [
  { title: "Help & Documentation — InvoiceGST" },
  { name: "description", content: "Complete guide for using InvoiceGST — GST invoices, GSTR reports, e-invoicing, templates, and more." },
];

const NAV_SECTIONS = [
  { id: "getting-started",   label: "Getting Started" },
  { id: "invoices",          label: "Invoices" },
  { id: "templates",         label: "Templates & Customisation" },
  { id: "reports",           label: "GST Reports" },
  { id: "einvoice",          label: "E-Invoice (IRN)" },
  { id: "email-whatsapp",    label: "Email & WhatsApp" },
  { id: "products-hsn",      label: "Products & HSN Codes" },
  { id: "settings",          label: "Settings" },
  { id: "plans",             label: "Plans & Billing" },
  { id: "faq",               label: "FAQ" },
];

const FAQ_ITEMS = [
  {
    q: "Are invoices generated automatically?",
    a: "Yes. Every order that is paid or fulfilled automatically triggers an invoice — Tax Invoice for taxable goods, Bill of Supply for exempt items, and Credit Note for refunds. No manual action is needed.",
  },
  {
    q: "How does the app determine CGST+SGST vs IGST?",
    a: "The app compares the seller's state (from your GSTIN in Settings) with the buyer's delivery state. Same state = CGST+SGST (intra-state). Different state = IGST (inter-state). This is calculated automatically per invoice.",
  },
  {
    q: "What is B2B vs B2C classification?",
    a: "If the buyer provides a GSTIN at checkout (collected via the GSTIN collection widget), the invoice is classified as B2B. Otherwise it is classified as B2C. B2B invoices appear in the GSTR-1 B2B section.",
  },
  {
    q: "Can I change an invoice after it is generated?",
    a: "Invoice data is pulled from your Shopify order at the time of generation. If you need a corrected invoice, you can regenerate it from the Invoice Detail page. Note: GST law requires a Credit Note for refunds — do not simply modify the original invoice.",
  },
  {
    q: "How do I send an invoice to a customer who did not receive it?",
    a: "Go to Invoices → click the invoice row → Invoice Detail → click Send Email. The invoice PDF is sent immediately to the buyer's email address.",
  },
  {
    q: "What does 'Bill of Supply' mean?",
    a: "A Bill of Supply is issued instead of a Tax Invoice when the goods or services are GST-exempt (0% tax rate). No tax amount appears on a Bill of Supply.",
  },
  {
    q: "Why is my invoice showing CGST+SGST but my order is from another state?",
    a: "Check that your GSTIN in Settings → Business Details has the correct 2-digit state code as the first two characters (e.g. 27 for Maharashtra). The app uses these first two digits to determine your registered state.",
  },
  {
    q: "Can I use my own SMTP server to send emails?",
    a: "Yes. Go to Settings → Email → SMTP. Enter your SMTP host, port, username, and password. Emails will then be sent from your own mail server and domain.",
  },
  {
    q: "Does the app support multiple GSTINs for different warehouses?",
    a: "Yes. Go to Settings → Locations. You can assign a separate GSTIN to each of your Shopify fulfillment locations. The correct GSTIN is used automatically based on where the order is fulfilled from.",
  },
  {
    q: "What is E-Invoice (IRN)?",
    a: "E-Invoice (Electronic Invoice) is a GST requirement for businesses above ₹5 crore annual turnover. It involves registering each invoice with the NIC Invoice Registration Portal (IRP) and receiving an IRN number + QR code. The app handles this automatically once you configure your NIC IRP credentials in Settings → E-Invoice.",
  },
  {
    q: "My PDF is not generating / shows blank. What should I do?",
    a: "1. Make sure the order has line items with prices. 2. Check that your business GSTIN is set in Settings. 3. Try regenerating from Invoice Detail → Regenerate. If the problem persists, contact support.",
  },
  {
    q: "What HSN code should I use for my products?",
    a: "HSN (Harmonised System of Nomenclature) codes are assigned by the government. You can look up the correct HSN for your product category at the GST Council website or consult your CA. Once you know the code, enter it in Products → click the product → Edit HSN.",
  },
  {
    q: "What is the invoice number format?",
    a: "Invoice numbers are formatted as [PREFIX][YEAR]/[SEQUENCE]. For example: INV2025/001. You can set your preferred prefix in Settings → Invoice Settings. The counter resets each financial year (April 1).",
  },
  {
    q: "Can I export invoices to Tally?",
    a: "Yes. Go to Reports → Tally Export. Select your date range and click Export. A Sales XML file downloads that you can import directly into Tally ERP 9 or TallyPrime.",
  },
  {
    q: "How do I cancel an E-Invoice (IRN)?",
    a: "Go to Invoice Detail → E-Invoice card → Cancel IRN. You must cancel within 24 hours of generation and provide a cancellation reason code as per NIC IRP requirements.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #e5e7eb" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", textAlign: "left", padding: "16px 0",
          background: "none", border: "none", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          gap: 16,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, color: "#111827", lineHeight: 1.5 }}>{q}</span>
        <span style={{ fontSize: 20, color: "#6b7280", flexShrink: 0, lineHeight: 1 }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <p style={{ margin: "0 0 16px", color: "#374151", fontSize: 14, lineHeight: 1.7, paddingRight: 24 }}>{a}</p>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState("getting-started");

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ fontFamily: "'Inter', Arial, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      {/* Header */}
      <header style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, background: "#2563eb",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 700, fontSize: 16,
            }}>G</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>InvoiceGST</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Help & Documentation</div>
            </div>
          </div>
          <a
            href="mailto:support@engees.in"
            style={{ fontSize: 14, color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
          >
            Contact Support
          </a>
        </div>
      </header>

      {/* Hero */}
      <div style={{ background: "linear-gradient(135deg, #1e40af 0%, #2563eb 100%)", color: "#fff", padding: "48px 24px", textAlign: "center" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 12, margin: "0 0 12px" }}>
          How can we help you?
        </h1>
        <p style={{ fontSize: 16, opacity: 0.85, margin: "0 0 24px" }}>
          Complete guide for setting up and using InvoiceGST
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a
            href="#getting-started"
            onClick={(e) => { e.preventDefault(); scrollTo("getting-started"); }}
            style={{
              background: "#fff", color: "#1e40af", padding: "10px 20px",
              borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none",
            }}
          >
            Get Started
          </a>
          <a
            href="#faq"
            onClick={(e) => { e.preventDefault(); scrollTo("faq"); }}
            style={{
              background: "rgba(255,255,255,0.15)", color: "#fff", padding: "10px 20px",
              borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.3)",
            }}
          >
            View FAQ
          </a>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px", display: "flex", gap: 40 }}>
        {/* Sidebar nav */}
        <aside style={{
          width: 220, flexShrink: 0, position: "sticky", top: 24,
          alignSelf: "flex-start", display: "none",
        }} className="help-sidebar">
          <nav>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Contents
            </div>
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => { e.preventDefault(); scrollTo(s.id); }}
                style={{
                  display: "block", padding: "7px 10px", borderRadius: 6, fontSize: 14,
                  color: activeSection === s.id ? "#2563eb" : "#374151",
                  background: activeSection === s.id ? "#eff6ff" : "transparent",
                  textDecoration: "none", fontWeight: activeSection === s.id ? 600 : 400,
                  marginBottom: 2,
                }}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0 }}>

          {/* ── Getting Started ─────────────────────────────────────────── */}
          <section id="getting-started" style={{ marginBottom: 56 }}>
            <SectionHeading>Getting Started</SectionHeading>
            <StepCard number="1" title="Install the app">
              Install InvoiceGST from the Shopify App Store. OAuth runs automatically — no separate account is needed.
              After installing, you are redirected to the 3-step setup wizard.
            </StepCard>
            <StepCard number="2" title="Enter your GSTIN & business details">
              <strong>Step 1 of onboarding:</strong> Enter your 15-character GSTIN, business name, full address,
              and select your state. The GSTIN format is validated automatically (15-character PAN-based check).
              <br /><br />
              <em>Example GSTIN: 24AAAAA0000A1Z5 (first 2 digits = state code, next 10 = PAN, then category digits)</em>
            </StepCard>
            <StepCard number="3" title="Set invoice number prefix & template">
              <strong>Step 2 of onboarding:</strong> Choose your invoice number prefix (e.g. <code>INV</code>).
              Invoices will be numbered INV2025/001, INV2025/002, etc. Pick your preferred invoice template from
              6 available designs. You can change both at any time in Settings.
            </StepCard>
            <StepCard number="4" title="Upload your logo (optional)">
              <strong>Step 3 of onboarding:</strong> Upload your business logo (PNG, JPG — max 2 MB).
              It will appear on all invoice PDFs. You can update it later in Settings → Business Details.
            </StepCard>
            <InfoBox>
              After completing setup, invoices will automatically be generated for all new orders from that point.
              Existing past orders can be found in the Orders section.
            </InfoBox>
          </section>

          {/* ── Invoices ────────────────────────────────────────────────── */}
          <section id="invoices" style={{ marginBottom: 56 }}>
            <SectionHeading>Invoices</SectionHeading>

            <SubHeading>Invoice types</SubHeading>
            <DocTable rows={[
              ["Tax Invoice", "Standard GST invoice for taxable goods/services. Includes CGST+SGST or IGST breakdown."],
              ["Bill of Supply", "Issued for GST-exempt (0%) goods or services. No tax amount on the document."],
              ["Credit Note", "Issued when a refund is processed. Linked to the original Tax Invoice."],
            ]} />

            <SubHeading>How invoices are generated</SubHeading>
            <p style={pStyle}>
              Invoices are created automatically via Shopify webhooks when an order is <strong>paid</strong> or
              <strong> fulfilled</strong> (configurable in Settings → Invoice Settings → Auto-generate trigger).
              Credit notes are created when a refund webhook fires.
            </p>

            <SubHeading>Downloading an invoice PDF</SubHeading>
            <ol style={{ ...pStyle, paddingLeft: 20 }}>
              <li style={{ marginBottom: 6 }}>Go to <strong>Invoices</strong> in the left menu.</li>
              <li style={{ marginBottom: 6 }}>Click the invoice row or click <strong>View</strong>.</li>
              <li style={{ marginBottom: 6 }}>On Invoice Detail, click <strong>Download PDF</strong>.</li>
              <li style={{ marginBottom: 6 }}>Choose <em>Original</em>, <em>Duplicate</em>, or <em>Triplicate</em>.</li>
            </ol>

            <SubHeading>Bulk download (Starter plan+)</SubHeading>
            <p style={pStyle}>
              On the Invoices list, check 2 or more rows. A bulk action bar appears at the bottom.
              Click <strong>Download PDFs</strong> to get all selected invoices as a single ZIP file.
            </p>

            <SubHeading>Filtering invoices</SubHeading>
            <p style={pStyle}>
              Use the search bar to find by invoice number, buyer name, email, or order number.
              Use the dropdowns to filter by document type (Tax Invoice / Bill of Supply / Credit Note)
              or tax type (IGST / CGST+SGST). Use the date range pickers to filter by invoice date.
            </p>

            <SubHeading>Invoice statuses</SubHeading>
            <DocTable rows={[
              ["B2B", "Buyer provided a GSTIN. Invoice is classified as business-to-business."],
              ["B2C", "No buyer GSTIN. Invoice is classified as business-to-consumer."],
              ["IGST", "Inter-state supply. Seller state ≠ buyer delivery state."],
              ["CGST+SGST", "Intra-state supply. Seller state = buyer delivery state."],
              ["Email: Sent", "Invoice email was successfully delivered to the buyer."],
              ["Email: Pending", "Email not yet sent (auto-email may be off, or email was not triggered yet)."],
            ]} />
          </section>

          {/* ── Templates ───────────────────────────────────────────────── */}
          <section id="templates" style={{ marginBottom: 56 }}>
            <SectionHeading>Templates & Customisation</SectionHeading>

            <p style={pStyle}>
              InvoiceGST comes with <strong>6 invoice templates</strong>. Each has a unique design and colour scheme.
              Go to <strong>Templates</strong> in the left menu to see all templates.
            </p>

            <SubHeading>Switching templates</SubHeading>
            <p style={pStyle}>
              Click <strong>Use Template</strong> on any template card. The Active badge moves to the new template.
              All future invoice PDFs will use this template. Existing invoices regenerate using the active template.
            </p>

            <SubHeading>Personalising a template</SubHeading>
            <p style={pStyle}>Click <strong>Personalise</strong> on any template to open the customiser. Changes you save here apply to that template. Available options:</p>
            <DocTable rows={[
              ["Branding", "Primary colour, secondary colour, font family, logo size."],
              ["Address", "Show/hide address block, choose address format."],
              ["Line Items", "Show/hide columns: HSN code, discount, unit price."],
              ["Totals", "Show/hide subtotal, tax breakdown, round-off, amount in words."],
              ["Footer", "Custom footer text, terms & conditions, bank details."],
              ["Labels", "Rename any label on the invoice (e.g. change 'Invoice' to your preferred term)."],
              ["Digital Signature", "Upload a signature image shown at the bottom of the PDF."],
              ["Custom Fields", "Add up to 3 extra fields that print on the invoice."],
            ]} />

            <InfoBox>
              Changes in the customiser are previewed live on the right side. Click <strong>Save</strong>
              to apply. The preview uses real invoice data from your most recent invoice.
            </InfoBox>
          </section>

          {/* ── Reports ─────────────────────────────────────────────────── */}
          <section id="reports" style={{ marginBottom: 56 }}>
            <SectionHeading>GST Reports</SectionHeading>

            <p style={pStyle}>
              Go to <strong>Reports</strong> in the left menu. Set a date range and click <strong>Generate</strong>.
              Reports are generated from your invoice data and are fully compatible with the GST Offline Utility.
            </p>

            <SubHeading>Available reports</SubHeading>
            <DocTable rows={[
              ["GSTR-1 B2B", "All B2B invoices — buyer GSTIN, invoice number, taxable value, tax amounts. Required monthly/quarterly filing."],
              ["GSTR-1 B2C", "All B2C invoices — grouped by state. For consumers without GSTIN."],
              ["GSTR-1 HSN Summary", "Aggregate HSN-wise summary — total quantity, taxable value, tax amounts per HSN code."],
              ["GSTR-3B Summary", "Summary totals for filing: outward supplies, tax liability, ITC claims."],
              ["Tally Export", "Sales XML file for direct import into Tally ERP 9 / TallyPrime."],
            ]} />

            <SubHeading>Downloading a CSV</SubHeading>
            <p style={pStyle}>
              After generating, click <strong>Download CSV</strong> in the respective tab. The CSV format matches
              the GST Offline Utility column requirements — open it in the utility without any editing.
            </p>

            <SubHeading>Report History</SubHeading>
            <p style={pStyle}>
              Every report you generate is logged in the <strong>Report History</strong> tab with date, type,
              and date range. This gives you a record of all filings.
            </p>
          </section>

          {/* ── E-Invoice ───────────────────────────────────────────────── */}
          <section id="einvoice" style={{ marginBottom: 56 }}>
            <SectionHeading>E-Invoice (IRN)</SectionHeading>

            <InfoBox type="warning">
              E-Invoice is mandatory for businesses with annual turnover above ₹5 crore (as per current GST rules).
              You need your own NIC IRP API credentials to use this feature.
            </InfoBox>

            <SubHeading>Setup</SubHeading>
            <ol style={{ ...pStyle, paddingLeft: 20 }}>
              <li style={{ marginBottom: 6 }}>Register on the NIC IRP portal (einvoice1.gst.gov.in) with your GSTIN.</li>
              <li style={{ marginBottom: 6 }}>Generate API credentials: Client ID, Client Secret, API Username, API Password.</li>
              <li style={{ marginBottom: 6 }}>In InvoiceGST, go to <strong>Settings → E-Invoice</strong>.</li>
              <li style={{ marginBottom: 6 }}>Enter your credentials and click <strong>Save & Test Connection</strong>.</li>
              <li style={{ marginBottom: 6 }}>Enable the <strong>Auto-generate IRN</strong> toggle.</li>
            </ol>

            <SubHeading>How IRN generation works</SubHeading>
            <p style={pStyle}>
              Once enabled, every new Tax Invoice automatically generates an IRN via NIC IRP.
              The signed QR code is embedded on the invoice PDF. You can also manually generate IRN
              from Invoice Detail → E-Invoice card → <strong>Generate IRN</strong>.
            </p>

            <SubHeading>Cancelling an IRN</SubHeading>
            <p style={pStyle}>
              IRN can be cancelled within <strong>24 hours</strong> of generation as per NIC IRP rules.
              Go to Invoice Detail → E-Invoice card → <strong>Cancel IRN</strong>. Select a cancellation
              reason code (1 = Duplicate, 2 = Data Entry Mistake, 3 = Order Cancelled, 4 = Others).
            </p>
          </section>

          {/* ── Email & WhatsApp ────────────────────────────────────────── */}
          <section id="email-whatsapp" style={{ marginBottom: 56 }}>
            <SectionHeading>Email & WhatsApp</SectionHeading>

            <SubHeading>Automatic invoice emails</SubHeading>
            <p style={pStyle}>
              Enable automatic emails in <strong>Settings → Invoice Settings → Auto-email</strong>.
              Set the trigger to <em>On Fulfillment</em> or <em>On Payment</em>. When an order hits the
              trigger event, the invoice PDF is attached and sent to the buyer's email address.
            </p>

            <SubHeading>Sending manually</SubHeading>
            <p style={pStyle}>
              Go to Invoice Detail → click <strong>Send Email</strong>. The email goes immediately to the
              buyer's email on the order. A success banner confirms delivery.
            </p>

            <SubHeading>Bulk email (Starter plan+)</SubHeading>
            <p style={pStyle}>
              On the Invoices list, select multiple rows → bulk action bar → <strong>Send Emails</strong>.
              All selected customers receive their individual invoice email.
            </p>

            <SubHeading>Custom SMTP</SubHeading>
            <p style={pStyle}>
              By default, emails are sent from <code>invoices@gstpro.viradiyainfotech.com</code>.
              To send from your own domain, go to <strong>Settings → Email → SMTP</strong> and enter:
            </p>
            <DocTable rows={[
              ["SMTP Host", "Your mail server hostname, e.g. smtp.gmail.com"],
              ["Port", "465 (SSL) or 587 (TLS/STARTTLS)"],
              ["Username", "Your email address"],
              ["Password", "Your email password or app password"],
              ["From Name", "Display name shown in the inbox, e.g. your business name"],
            ]} />

            <SubHeading>WhatsApp (Growth plan+)</SubHeading>
            <p style={pStyle}>
              On Invoice Detail, click <strong>WhatsApp</strong>. This opens a pre-filled WhatsApp message
              on your phone with a link to the invoice PDF. Send it directly to the customer from your phone.
              No WhatsApp Business API account is needed.
            </p>
          </section>

          {/* ── Products & HSN ──────────────────────────────────────────── */}
          <section id="products-hsn" style={{ marginBottom: 56 }}>
            <SectionHeading>Products & HSN Codes</SectionHeading>

            <p style={pStyle}>
              GST law requires an HSN (Harmonised System of Nomenclature) code on every invoice line item.
              Go to <strong>Products</strong> in the left menu to manage HSN codes for your products.
            </p>

            <SubHeading>Setting HSN codes</SubHeading>
            <ol style={{ ...pStyle, paddingLeft: 20 }}>
              <li style={{ marginBottom: 6 }}>Go to <strong>Products</strong>.</li>
              <li style={{ marginBottom: 6 }}>Find the product and click <strong>Edit HSN</strong>.</li>
              <li style={{ marginBottom: 6 }}>Enter the HSN code (4 to 8 digits) and click Save.</li>
            </ol>

            <InfoBox>
              If some products are missing HSN codes, the Dashboard will show a warning banner.
              Click <strong>Fix Now</strong> to go directly to the Products page.
            </InfoBox>

            <SubHeading>GST rate per product</SubHeading>
            <p style={pStyle}>
              The GST rate on each line item is taken from the tax rate set on your Shopify product.
              Make sure your products have the correct Shopify tax rate (5%, 12%, 18%, 28%) set
              in Shopify Admin → Products → Taxes.
            </p>

            <SubHeading>Collections</SubHeading>
            <p style={pStyle}>
              You can set HSN codes at the collection level from <strong>Products → Collections</strong>.
              All products in that collection will use the collection's HSN code as a default
              (individual product HSN overrides the collection HSN).
            </p>
          </section>

          {/* ── Settings ────────────────────────────────────────────────── */}
          <section id="settings" style={{ marginBottom: 56 }}>
            <SectionHeading>Settings</SectionHeading>

            <DocTable rows={[
              ["Business Details", "Your GSTIN, business name, address, state, phone, email. These appear on all invoice PDFs."],
              ["Invoice Settings", "Invoice number prefix, auto-generate trigger (paid/fulfilled), invoice copy label, financial year start."],
              ["Auto-email", "Enable/disable automatic customer emails. Set trigger event. Preview email template."],
              ["Email → SMTP", "Configure custom SMTP server for sending from your own domain."],
              ["Locations", "Assign a different GSTIN to each fulfillment location for multi-branch businesses."],
              ["E-Invoice", "Enter NIC IRP API credentials. Enable/disable auto IRN generation."],
            ]} />

            <SubHeading>Updating your logo</SubHeading>
            <p style={pStyle}>
              Go to <strong>Settings → Business Details</strong>. Scroll to the Logo section.
              Click <strong>Change Logo</strong> to upload a new image (PNG, JPG, max 2 MB).
              The new logo appears on all future PDFs immediately.
            </p>
          </section>

          {/* ── Plans ───────────────────────────────────────────────────── */}
          <section id="plans" style={{ marginBottom: 56 }}>
            <SectionHeading>Plans & Billing</SectionHeading>

            <p style={pStyle}>Go to <strong>Billing</strong> in the left menu to view and change your plan.</p>

            <DocTable headers={["Plan", "Orders/month", "Key features"]} rows={[
              ["Free", "5", "Auto invoices, 6 templates, basic GSTR reports, email delivery"],
              ["Starter — $4.95/mo", "300", "Everything Free + Bulk PDF download, Bulk email"],
              ["Growth — $9.99/mo", "2,500", "Everything Starter + WhatsApp share, Tally export, custom SMTP"],
              ["Scale — $34.99/mo", "Unlimited", "Everything Growth + E-Invoice IRN, multi-location GSTIN"],
            ]} />

            <InfoBox>
              All paid plans include a <strong>7-day free trial</strong>. You are not charged until the trial ends.
              Billing is handled by Shopify — charges appear on your Shopify invoice.
            </InfoBox>

            <SubHeading>What counts as an order?</SubHeading>
            <p style={pStyle}>
              Each Shopify order that triggers an invoice counts as 1 order against your monthly limit.
              Credit notes (refunds) do not count separately. Development store orders do not count.
            </p>
          </section>

          {/* ── FAQ ─────────────────────────────────────────────────────── */}
          <section id="faq" style={{ marginBottom: 56 }}>
            <SectionHeading>Frequently Asked Questions</SectionHeading>
            <div style={{ background: "#fff", borderRadius: 12, padding: "8px 24px", border: "1px solid #e5e7eb" }}>
              {FAQ_ITEMS.map((item, i) => (
                <FaqItem key={i} q={item.q} a={item.a} />
              ))}
            </div>
          </section>

          {/* Contact */}
          <section style={{ background: "#1e40af", borderRadius: 16, padding: "40px", textAlign: "center", color: "#fff", marginBottom: 40 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>Still have questions?</h2>
            <p style={{ opacity: 0.85, margin: "0 0 24px", fontSize: 15 }}>
              Our support team is happy to help you with setup, GST compliance questions, or any issues.
            </p>
            <a
              href="mailto:support@engees.in"
              style={{
                display: "inline-block", background: "#fff", color: "#1e40af",
                padding: "12px 28px", borderRadius: 8, fontWeight: 700, fontSize: 15,
                textDecoration: "none",
              }}
            >
              Email support@engees.in
            </a>
          </section>

        </main>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
        InvoiceGST — Smart GST Invoicing &nbsp;·&nbsp; Developed by{" "}
        <a href="https://engees.in" style={{ color: "#6b7280" }}>Engees</a>
        &nbsp;·&nbsp;
        <a href="/privacy" style={{ color: "#6b7280" }}>Privacy Policy</a>
      </footer>

      {/* Responsive sidebar style */}
      <style>{`
        @media (min-width: 900px) {
          .help-sidebar { display: block !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        code {
          background: #f3f4f6; padding: 2px 6px; border-radius: 4px;
          font-family: monospace; font-size: 13px;
        }
      `}</style>
    </div>
  );
}

// ── Helper components ────────────────────────────────────────────────────────

const pStyle: React.CSSProperties = { margin: "0 0 16px", color: "#374151", fontSize: 14, lineHeight: 1.7 };

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: "0 0 20px", paddingBottom: 12, borderBottom: "2px solid #e5e7eb" }}>
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", margin: "24px 0 8px" }}>
      {children}
    </h3>
  );
}

function StepCard({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", background: "#2563eb", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 15, flexShrink: 0, marginTop: 2,
      }}>
        {number}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: "#111827", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}

function InfoBox({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warning" }) {
  const colors = type === "warning"
    ? { bg: "#fffbeb", border: "#fcd34d", icon: "⚠️", text: "#92400e" }
    : { bg: "#eff6ff", border: "#93c5fd", icon: "ℹ️", text: "#1e40af" };
  return (
    <div style={{
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: 10, padding: "14px 18px", marginBottom: 20,
      display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{colors.icon}</span>
      <p style={{ margin: 0, fontSize: 14, color: colors.text, lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

function DocTable({ rows, headers }: { rows: string[][]; headers?: string[] }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: 20 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        {headers && (
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              {headers.map((h, i) => (
                <th key={i} style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "10px 14px", color: j === 0 ? "#111827" : "#374151", fontWeight: j === 0 ? 600 : 400, verticalAlign: "top" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
