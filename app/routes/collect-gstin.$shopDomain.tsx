// Public page — no Shopify auth required.
// Merchants share this URL with B2B buyers so they can submit their GSTIN.
// URL: /collect-gstin/{shopDomain}  e.g. /collect-gstin/mystore.myshopify.com
//
// Because anyone with the link can post here, submissions are stored as "pending approval"
// and never overwrite an existing customer — otherwise someone could attach a real company's
// GSTIN to their own email and get B2B invoices (and input tax credit) in that company's name.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { prisma } from "~/db.server";
import { STATE_CODES, validateGstin } from "~/lib/gst";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const shopDomain = decodeURIComponent(params.shopDomain || "");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, businessName: true, logoUrl: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return json({ shop, shopDomain });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shopDomain = decodeURIComponent(params.shopDomain || "");
  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const companyName = ((formData.get("companyName") as string) || "").trim().slice(0, 200);
  const gstin = ((formData.get("gstin") as string) || "").trim().toUpperCase();
  const email = ((formData.get("email") as string) || "").trim().toLowerCase().slice(0, 200);
  const phone = ((formData.get("phone") as string) || "").trim().slice(0, 30) || null;

  if (companyName.length < 2)
    return json({ error: "Company name is required (min 2 characters)" }, { status: 400 });
  if (!validateGstin(gstin))
    return json({ error: "This GSTIN is not valid. Please check it on your GST registration certificate." }, { status: 400 });
  // Email is how the seller matches your orders to this GSTIN
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: "Please enter the email address you use to place orders." }, { status: 400 });

  // Never overwrite an existing entry from a public form; the seller reviews new ones
  const existing = await prisma.b2BCustomer.findFirst({ where: { shopId: shop.id, gstin }, select: { id: true } });
  if (!existing) {
    await prisma.b2BCustomer.create({
      data: {
        shopId: shop.id, companyName, gstin, email, phone,
        stateCode: gstin.slice(0, 2), state: STATE_CODES[gstin.slice(0, 2)] || null,
        pendingApproval: true,
      },
    });
  }

  // Same response either way, so the form can't be used to probe which GSTINs a store has
  return json({ success: true });
};

// ── Page component ────────────────────────────────────────────────────────────

type ActionData = { success?: boolean; error?: string };

export default function CollectGstinPage() {
  const { shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  const [companyName, setCompanyName] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const isLoading = fetcher.state !== "idle";
  const isSuccess = fetcher.data?.success === true;
  const error = fetcher.data?.error;

  const gstinState = gstin.length >= 2 ? STATE_CODES[gstin.slice(0, 2)] : "";
  const gstinInvalid = gstin.length === 15 && !validateGstin(gstin);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("companyName", companyName);
    fd.append("gstin", gstin);
    fd.append("email", email);
    fd.append("phone", phone);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          {shop.logoUrl && (
            <img src={shop.logoUrl} alt={shop.businessName || "Logo"} style={{ height: 56, objectFit: "contain", marginBottom: 16 }} />
          )}
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
            {shop.businessName || "Business"}
          </h1>
          <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
            Submit your GST details to receive GST-compliant tax invoices.
          </p>
        </div>

        {/* Success state */}
        {isSuccess ? (
          <div style={{ background: "#fff", borderRadius: 12, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#2e7d32", margin: "0 0 8px" }}>GST details received</h2>
            <p style={{ fontSize: 14, color: "#555", margin: 0 }}>
              {shop.businessName || "The seller"} will review your details. Once approved, your GSTIN will be added to
              invoices for orders placed with this email address.
            </p>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, padding: 32, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1a1a1a", margin: "0 0 24px" }}>
              Enter Your GST Details
            </h2>

            {error && (
              <div style={{ background: "#fff3f3", border: "1px solid #f44336", borderRadius: 6, padding: "10px 14px", color: "#c62828", fontSize: 14, marginBottom: 20 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label style={labelStyle} htmlFor="companyName">Registered Business Name *</label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="As on your GST certificate"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="gstin">GSTIN *</label>
                <input
                  id="gstin"
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))}
                  placeholder="15-character GSTIN"
                  maxLength={15}
                  required
                  style={{
                    ...inputStyle,
                    fontFamily: "monospace",
                    letterSpacing: 1,
                    borderColor: gstinInvalid ? "#f44336" : gstin.length === 15 ? "#4caf50" : undefined,
                  }}
                />
                {gstinInvalid ? (
                  <p style={{ fontSize: 12, color: "#c62828", margin: "4px 0 0" }}>This GSTIN doesn't look valid — please check it.</p>
                ) : gstinState ? (
                  <p style={{ fontSize: 12, color: "#4caf50", margin: "4px 0 0" }}>State: {gstinState}</p>
                ) : null}
              </div>

              <div>
                <label style={labelStyle} htmlFor="email">Email used for orders *</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="accounts@company.com"
                  required
                  style={inputStyle}
                />
                <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                  Your GSTIN is added to invoices for orders placed with this email.
                </p>
              </div>

              <div>
                <label style={labelStyle} htmlFor="phone">Phone Number (optional)</label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || companyName.trim().length < 2 || gstin.length !== 15 || gstinInvalid || !email}
                style={{
                  background: isLoading ? "#90caf9" : "#1a73e8",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "14px 24px",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: isLoading ? "not-allowed" : "pointer",
                  transition: "background 0.2s",
                  marginTop: 4,
                }}
              >
                {isLoading ? "Submitting…" : "Submit GST Details"}
              </button>
            </form>

            <p style={{ fontSize: 12, color: "#aaa", marginTop: 20, textAlign: "center" }}>
              Your information is securely stored and used only for GST invoice generation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#444",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid #ddd",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 14,
  color: "#1a1a1a",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.2s",
};
