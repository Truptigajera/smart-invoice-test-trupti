import { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";

// Returns the Shop row for a domain, creating it on first visit.
// Remix runs the /app layout loader and the page loader in parallel, so two requests
// can try to create the same shop at once — the unique index rejects the second,
// and we simply read the row the first one created.
export async function getOrCreateShop(shopDomain: string) {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) return existing;
  try {
    return await prisma.shop.create({ data: { shopDomain } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.shop.findUniqueOrThrow({ where: { shopDomain } });
    }
    throw err;
  }
}
