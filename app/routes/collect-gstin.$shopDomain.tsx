// Public page — no Shopify auth required.
// Merchants share this URL with B2B buyers so they can submit their GSTIN.
// URL: /collect-gstin/{shopDomain}  e.g. /collect-gstin/mystore.myshopify.com

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { prisma } from "~/db.server";

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
  const companyName = (formData.get("companyName") as string)?.trim();
  const gstin = (formData.get("gstin") as string)?.trim().toUpperCase();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;

  if (!companyName || companyName.length < 2)
    return json({ error: "Company name is required (min 2 characters)" }, { status: 400 });

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(gstin))
    return json({ error: "Invalid GSTIN format. Must be 15 characters (e.g. 27AAPFU0939F1ZV)" }, { status: 400 });

  // Upsert by shopId + gstin — if GSTIN already exists, update company name/contact
  await prisma.b2BCustomer.upsert({
    where: { shopId_gstin: { shopId: shop.id, gstin } },
    create: { shopId: shop.id, companyName, gstin, email, phone },
    update: { companyName, email, phone },
  });

  return json({ success: true });
};

// ── GSTIN state code validator ────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam",
  "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra", "28": "Andhra Pradesh", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh (new)",
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
  const [gstinHint, setGstinHint] = useState("");

  const isLoading = fetcher.state !== "idle";
  const isSuccess = fetcher.data?.success === true;
  const error = fetcher.data?.error;

  const handleGstinChange = (val: string) => {
    const upper = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
    setGstin(upper);
    const code = upper.slice(0, 2);
    const state = STATE_CODES[code];
    setGstinHint(upper.length >= 2 && state ? `State: ${state}` : "");
  };

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
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#2e7d32", margin: "0 0 8px" }}>GSTIN Submitted!</h2>
            <p style={{ fontSize: 14, color: "#555", margin: 0 }}>
              Your GST details have been saved. Future invoices from {shop.businessName || "this seller"} will include your GSTIN automatically.
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
                <label style={labelStyle}>Company / Business Name *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. ABC Enterprises"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>GSTIN *</label>
                <input
                  type="text"
                  value={gstin}
                  onChange={(e) => handleGstinChange(e.target.value)}
                  placeholder="e.g. 27AAPFU0939F1ZV"
                  maxLength={15}
                  required
                  style={{
                    ...inputStyle,
                    fontFamily: "monospace",
                    letterSpacing: 1,
                    borderColor: gstin.length === 15 ? "#4caf50" : undefined,
                  }}
                />
                {gstinHint && (
                  <p style={{ fontSize: 12, color: "#4caf50", margin: "4px 0 0" }}>{gstinHint}</p>
                )}
                <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                  15-character GST Identification Number
                </p>
              </div>

              <div>
                <label style={labelStyle}>Email Address (optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="accounts@company.com"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Phone Number (optional)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !companyName || gstin.length !== 15}
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
