// Server-side GSTIN lookup — always returns state from prefix, optionally fetches
// business name + address from a configured external API.
//
// Env vars (optional):
//   GSTIN_API_URL  — Full URL with {gstin} placeholder, e.g.
//                    https://api.sandbox.co.in/kyc/gstin/{gstin}
//   GSTIN_API_KEY  — Bearer token / API key for the above URL
//
// Without env vars: returns stateCode + state (free, derived from GSTIN prefix).
// With env vars:    additionally returns businessName, tradeName, address, city, pincode.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { STATE_CODES } from "~/lib/gst";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const gstin = url.searchParams.get("gstin")?.toUpperCase().trim() ?? "";

  if (!GSTIN_RE.test(gstin)) {
    return json({ error: "Invalid GSTIN format" }, { status: 400 });
  }

  const stateCode = gstin.slice(0, 2);
  const state = STATE_CODES[stateCode] ?? "";

  // Try external API if configured
  const apiUrl = process.env.GSTIN_API_URL;
  const apiKey = process.env.GSTIN_API_KEY;

  if (apiUrl) {
    try {
      const endpoint = apiUrl.replace("{gstin}", gstin);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const resp = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const data = await resp.json();
        return json(parseApiResponse(data, stateCode, state));
      }
    } catch {
      // fall through to state-only response
    }
  }

  // State-only response (free, no external API needed)
  return json({ stateCode, state, fromApi: false });
};

// Normalises responses from two common formats:
//   MasterGST / NIC IRP:  { lgnm, tradeNam, pradr: { addr: { bno, bnm, st, dst, pncd } } }
//   Sandbox.co.in:        { data: { legal_name, trade_name, address: { ... } } }
function parseApiResponse(
  raw: Record<string, unknown>,
  stateCode: string,
  state: string
) {
  // MasterGST / NIC format
  if (raw.lgnm !== undefined) {
    const addr = (raw.pradr as Record<string, unknown>)?.addr as Record<string, string> | undefined;
    const parts = [addr?.bno, addr?.bnm, addr?.st].filter(Boolean);
    return {
      stateCode,
      state,
      businessName: (raw.lgnm as string) || null,
      tradeName: (raw.tradeNam as string) || null,
      address: parts.join(", ") || null,
      city: addr?.dst ?? addr?.loc ?? null,
      pincode: addr?.pncd ?? null,
      fromApi: true,
    };
  }

  // Sandbox.co.in format
  if ((raw.data as Record<string, unknown>)?.legal_name !== undefined) {
    const d = raw.data as Record<string, unknown>;
    const addr = d.address as Record<string, string> | undefined;
    return {
      stateCode,
      state,
      businessName: (d.legal_name as string) || null,
      tradeName: (d.trade_name as string) || null,
      address: addr?.line1 ?? addr?.address1 ?? null,
      city: addr?.city ?? addr?.district ?? null,
      pincode: addr?.pincode ?? addr?.zip ?? null,
      fromApi: true,
    };
  }

  return { stateCode, state, fromApi: false };
}
