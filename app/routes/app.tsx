import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useNavigation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { redirect } from "@remix-run/node";
import { prisma } from "../db.server";
import { getOrCreateShop } from "../lib/shop.server";
import { PlanLimitModal } from "../components/PlanLimitModal";
import { rememberEmbeddedContext } from "../lib/embedded-recovery";
import { useEffect } from "react";
import { BILLING_IS_TEST } from "../billing-plans";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  // Every /app page needs a finished setup (GSTIN, state, business name) — otherwise
  // invoices get the wrong tax type. Send unfinished shops to onboarding first.
  const shop = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  if (!shop.onboardingDone) {
    if (url.pathname !== "/app/onboarding") {
      throw redirect(`/app/onboarding?${url.searchParams.toString()}`);
    }
    // Skip the billing round-trip to Shopify during onboarding — keeps first load fast
    return { apiKey: process.env.SHOPIFY_API_KEY || "" };
  }

  // Sync active Shopify subscription → shop.currentPlan in DB
  // Runs on every page so plan gates are always up to date
  try {
    // No `plans` filter: any active subscription counts as paid — the current Pro plan, and also
    // the retired Startup/Business/Advanced plans that existing merchants may still be on.
    const billingCheck = await billing.check({ isTest: BILLING_IS_TEST });
    const activeSub = billingCheck.appSubscriptions[0] ?? null;
    const newPlan = activeSub?.name ?? "free";
    await prisma.shop.update({
      where: { shopDomain: session.shop },
      data: { currentPlan: newPlan },
    });
  } catch {
    // Non-critical — don't break the app if billing check fails
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function NavLoadingBar() {
  const navigation = useNavigation();
  if (navigation.state === "idle") return null;
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, height: 3,
      background: "#008060", zIndex: 9999,
      animation: "gst-nav-progress 1.2s ease-in-out infinite",
    }}>
      <style>{`
        @keyframes gst-nav-progress {
          0%   { opacity: 1; width: 20%; }
          50%  { opacity: 1; width: 75%; }
          100% { opacity: 0; width: 95%; }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  // Lets the login page send the merchant back here if the iframe ever reloads without its params
  useEffect(() => {
    rememberEmbeddedContext();
  }, []);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavLoadingBar />
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/orders">Orders</Link>
        <Link to="/app/estimates">Estimates</Link>
        <Link to="/app/invoices">Invoices</Link>
        <Link to="/app/products">Products &amp; HSN</Link>
        <Link to="/app/customers">B2B Customers</Link>
        <Link to="/app/reports">GST Reports</Link>
        <Link to="/app/templates">Templates</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/settings/smtp">Email (SMTP)</Link>
        <Link to="/app/settings/locations">Locations</Link>
        <Link to="/app/products/collections">Collection HSN</Link>
        <Link to="/app/billing">Billing</Link>
      </NavMenu>
      <Outlet />
      <PlanLimitModal />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
