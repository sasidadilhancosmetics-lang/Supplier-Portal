/**
 * Read-only: list SENT/CONFIRMED POs that must not be auto-cancelled.
 * Usage: npx tsx scripts/list-open-pos-readonly.ts
 */
import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const open = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["SENT", "CONFIRMED"] } },
    select: {
      orderNumber: true,
      status: true,
      supplier: { select: { name: true } },
      company: { select: { name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log(
    JSON.stringify(
      {
        warning: "Do not cancel these for UAT unless they are disposable test POs you just created.",
        count: open.length,
        open,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
