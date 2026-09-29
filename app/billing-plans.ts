// The only paid plan. This name is shown on Shopify's charge approval screen and must match
// the key in shopify.server.ts billing config.
export const PLAN_PRO = "Pro";
export const PLAN_PRO_PRICE = 4.99; // USD, every 30 days

// Free plan: invoices for this many orders per calendar month
export const FREE_ORDER_LIMIT = 5;

// Test charges can be approved without real payment. Set to false before going live,
// otherwise merchants are never actually billed.
export const BILLING_IS_TEST = true;
