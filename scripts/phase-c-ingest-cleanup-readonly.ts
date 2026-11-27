/**
 * Read-only check: leftovers from Phase C1/C2 ingest integration tests.
 * SELECT only. Refuses production. Does not delete anything.
 *
 * Usage: npx tsx scripts/phase-c-ingest-cleanup-readonly.ts
 */
import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";

async function main() {
  const branchId = process.env.NEON_BRANCH_ID ?? null;
  if (branchId === PRODUCTION_BRANCH_ID) {
    throw new Error("Refusing to run: production branch.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    const testCompanies = await prisma.company.findMany({
      where: {
        OR: [
          { id: { startsWith: "c1_" } },
          { name: { startsWith: "Company c1_" } },
          { name: { startsWith: "Other c1_" } },
        ],
      },
      select: { id: true, name: true, createdAt: true },
    });

    const testCreds = await prisma.integrationCredential.findMany({
      where: {
        OR: [
          { id: { startsWith: "c1_" } },
          { name: { in: ["active", "other-co", "revoked"] } },
        ],
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        tokenPrefix: true,
        isActive: true,
        createdAt: true,
      },
    });

    const testImports = await prisma.osfImport.findMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: "key-" } },
          { companyId: { startsWith: "c1_" } },
        ],
      },
      select: {
        id: true,
        companyId: true,
        idempotencyKey: true,
        status: true,
        createdAt: true,
      },
      take: 50,
    });

    const integrationAudits = await prisma.auditLog.count({
      where: {
        actorUserId: null,
        entityType: { in: ["OsfImport", "Requirement"] },
      },
    });

    const protectedPo = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { id: true, orderNumber: true, status: true, updatedAt: true },
    });

    const osfImportTotal = await prisma.osfImport.count();
    const osfLineTotal = await prisma.osfImportLine.count();

    const leftoverCompanyIds = testCompanies.map((c) => c.id);
    // Credentials named active/other-co/revoked may be false positives if staff
    // create real ones with those names — flag only when companyId looks like a test id.
    const leftoverCreds = testCreds.filter(
      (c) =>
        c.id.startsWith("c1_") ||
        c.companyId.startsWith("c1_") ||
        leftoverCompanyIds.includes(c.companyId),
    );
    const leftoverImports = testImports.filter(
      (i) =>
        i.companyId.startsWith("c1_") ||
        leftoverCompanyIds.includes(i.companyId) ||
        /^(key-(create|brand|parallel|rollback|replay|audit|other|dup))/i.test(
          i.idempotencyKey,
        ),
    );

    console.log(
      JSON.stringify(
        {
          identity: {
            neonBranchId: branchId,
            isProduction: false,
          },
          leftoverTestCompanies: testCompanies,
          leftoverTestCredentials: leftoverCreds.map((c) => ({
            id: c.id,
            companyId: c.companyId,
            name: c.name,
            tokenPrefix: c.tokenPrefix,
            isActive: c.isActive,
          })),
          leftoverTestImports: leftoverImports,
          totals: {
            osfImportTotal,
            osfLineTotal,
            integrationOriginAuditRows: integrationAudits,
          },
          protectedPo,
          cleanupNeeded:
            testCompanies.length > 0 ||
            leftoverCreds.length > 0 ||
            leftoverImports.length > 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
