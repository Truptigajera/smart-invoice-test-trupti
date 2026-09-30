import { PrismaClient } from "@prisma/client";
import { DEFAULT_FREE_INVOICE_LIMIT } from "./billing-plans";

declare global {
  var prismaGlobal: PrismaClient;
  var prismaConnectionLogged: boolean | undefined;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

// Log MongoDB connection status once on server start (host + db name only, never the password)
if (!global.prismaConnectionLogged) {
  global.prismaConnectionLogged = true;
  let target = "unknown";
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    target = `${url.host}${url.pathname}`;
  } catch {
    // DATABASE_URL missing or malformed — the ping below will report the error
  }
  prisma
    .$runCommandRaw({ ping: 1 })
    .then(() => console.log(`✅ MongoDB connected: ${target}`))
    // Stores installed before Shop.freeInvoiceLimit existed have no value yet — give them the default.
    // Stores that already have a value (including one edited by hand) are left alone.
    // (Raw command: Prisma can't filter a required field on "missing".)
    .then(() =>
      prisma.$runCommandRaw({
        update: "Shop",
        updates: [{
          q: { freeInvoiceLimit: { $exists: false } },
          u: { $set: { freeInvoiceLimit: DEFAULT_FREE_INVOICE_LIMIT } },
          multi: true,
        }],
      })
    )
    .then((r) => {
      const count = Number((r as { nModified?: number }).nModified ?? 0);
      if (count) console.log(`[plans] Set freeInvoiceLimit=${DEFAULT_FREE_INVOICE_LIMIT} on ${count} existing shop(s)`);
    })
    .catch((err) => console.error(`❌ MongoDB connection failed: ${target}\n`, err?.message ?? err));
}

export { prisma };
export default prisma;
