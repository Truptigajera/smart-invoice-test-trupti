// The only paid plan. This name is shown on Shopify's charge approval screen and must match
// the key in shopify.server.ts billing config.
export const PLAN_PRO = "Pro";
export const PLAN_PRO_PRICE = 4.99; // USD, every 30 days

// Free plan invoices per month given to a newly installed store. Each store's actual limit lives
// in its Shop record (freeInvoiceLimit) and can be changed there. Keep this in sync with the
// @default on Shop.freeInvoiceLimit in prisma/schema.prisma.
export const DEFAULT_FREE_INVOICE_LIMIT = 5;

// Test charges can be approved without real payment. Set to false before going live,
// otherwise merchants are never actually billed.
export const BILLING_IS_TEST = true;
