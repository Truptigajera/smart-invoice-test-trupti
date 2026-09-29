import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
export {
  PLAN_STARTUP, PLAN_BUSINESS, PLAN_ADVANCED,
  PLAN_STARTUP_ANNUAL, PLAN_BUSINESS_ANNUAL, PLAN_ADVANCED_ANNUAL,
} from "./billing-plans";
import {
  PLAN_STARTUP, PLAN_BUSINESS, PLAN_ADVANCED,
  PLAN_STARTUP_ANNUAL, PLAN_BUSINESS_ANNUAL, PLAN_ADVANCED_ANNUAL,
} from "./billing-plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    // Shopify's Admin API rejects non-expiring offline tokens — request expiring ones
    // (the library refreshes them automatically before they expire)
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [PLAN_STARTUP]: {
      trialDays: 7,
      lineItems: [{ amount: 9.90, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    [PLAN_BUSINESS]: {
      trialDays: 7,
      lineItems: [{ amount: 19.98, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    [PLAN_ADVANCED]: {
      trialDays: 7,
      lineItems: [{ amount: 69.98, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    [PLAN_STARTUP_ANNUAL]: {
      trialDays: 7,
      lineItems: [{ amount: 77.28, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
    [PLAN_BUSINESS_ANNUAL]: {
      trialDays: 7,
      lineItems: [{ amount: 155.88, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
    [PLAN_ADVANCED_ANNUAL]: {
      trialDays: 7,
      lineItems: [{ amount: 545.88, currencyCode: "USD", interval: BillingInterval.Annual }],
    },
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/paid",
    },
    ORDERS_FULFILLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/fulfilled",
    },
    REFUNDS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/refunds/create",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      await shopify.registerWebhooks({ session });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Offline sessions saved before expiringOfflineAccessTokens was enabled hold non-expiring tokens,
// which Shopify now rejects — yet the library treats them as valid forever and never replaces them.
// Delete them once at startup; the next time the merchant opens the app, token exchange silently
// stores a fresh expiring token. (Expiring sessions always have `expires`, so they are untouched.)
prisma.session
  .deleteMany({ where: { isOnline: false, OR: [{ expires: null }, { expires: { isSet: false } }] } })
  .then(({ count }) => {
    if (count) console.log(`[auth] Removed ${count} legacy non-expiring offline session(s)`);
  })
  .catch((err) => console.error("[auth] Legacy session cleanup failed:", err));

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
