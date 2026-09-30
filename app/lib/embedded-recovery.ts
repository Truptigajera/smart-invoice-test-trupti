// Recovers from the stray "Log in" page inside Shopify admin.
//
// When the app iframe does a full reload of an /app/* URL that no longer carries the embedded
// params (shop, host) — e.g. a Vite reload in dev, a server restart, or a plain <a href> link —
// the Shopify library can't tell which store it is and redirects to /auth/login.
// We remember shop + host for this browser tab on every successful load, and the login page
// uses them to send the merchant straight back into the app instead of showing the form.

const CONTEXT_KEY = "gst-embedded-context";
const ATTEMPT_KEY = "gst-embedded-recovery-at";
// If the app bounces back to login again within this window, give up and show the form
// rather than looping forever.
const RETRY_WINDOW_MS = 15_000;

// Call on every page load of the embedded app (client side only)
export function rememberEmbeddedContext() {
  try {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop");
    const host = params.get("host");
    if (shop && host) sessionStorage.setItem(CONTEXT_KEY, JSON.stringify({ shop, host }));
  } catch {
    // sessionStorage can be blocked (e.g. strict privacy settings) — recovery is best-effort
  }
}

// Returns the URL to reload the app with, or null when recovery isn't possible/safe
export function getEmbeddedRecoveryUrl(): string | null {
  try {
    if (window.top === window.self) return null; // opened directly, not inside Shopify admin
    const saved = sessionStorage.getItem(CONTEXT_KEY);
    if (!saved) return null;
    const { shop, host } = JSON.parse(saved) as { shop?: string; host?: string };
    if (!shop || !host) return null;

    const lastAttempt = Number(sessionStorage.getItem(ATTEMPT_KEY) || 0);
    if (Date.now() - lastAttempt < RETRY_WINDOW_MS) return null;
    sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));

    const params = new URLSearchParams({ shop, host, embedded: "1" });
    return `/app?${params.toString()}`;
  } catch {
    return null;
  }
}
