/**
 * Read-only: inventory OsfImport rows before schema changes.
 * Usage: npx tsx scripts/osf-import-inventory-readonly.ts
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
  const [total, byStatus, sample, reqLinked] = await Promise.all([
    prisma.osfImport.count(),
    prisma.osfImport.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.osfImport.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        idempotencyKey: true,
        externalId: true,
        processedAt: true,
        receivedAt: true,
        errorMessage: true,
        _count: { select: { requirements: true } },
      },
    }),
    prisma.requirement.count({ where: { osfImportId: { not: null } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        total,
        byStatus,
        requirementsLinkedToImport: reqLinked,
        sample,
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
