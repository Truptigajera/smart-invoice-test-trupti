import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

// Health-check endpoint — verifies the MongoDB connection is alive
export const loader = async (_: LoaderFunctionArgs) => {
  await prisma.$runCommandRaw({ ping: 1 });
  return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
};
