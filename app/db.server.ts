import { PrismaClient } from "@prisma/client";

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
    .catch((err) => console.error(`❌ MongoDB connection failed: ${target}\n`, err?.message ?? err));
}

export { prisma };
export default prisma;
