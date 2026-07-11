import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";

// Keep-alive endpoint — pinged every 5 min by UptimeRobot to prevent Neon DB auto-pause
export const loader = async (_: LoaderFunctionArgs) => {
  await prisma.$queryRaw`SELECT 1`;
  return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
};
