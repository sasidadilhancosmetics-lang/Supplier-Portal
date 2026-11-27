/**
 * Read-only Phase B pre-migration safety checks (Neon development only).
 * Executes SELECT statements only. Refuses to run against the production branch.
 *
 * Usage: npx tsx scripts/phase-b-db-safety-readonly.ts
 */
import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";
const EXPECTED_DEV_BRANCH_ID = "br-morning-glade-b3odmb6e";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

async function main() {
  const branchId = process.env.NEON_BRANCH_ID ?? null;
  const branchName = process.env.NEON_BRANCH ?? null;
  const pooledHost = hostOf(process.env.DATABASE_URL);
  const directHost = hostOf(
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_DATABASE_URL,
  );

  if (branchId === PRODUCTION_BRANCH_ID) {
    throw new Error("Refusing to run: NEON_BRANCH_ID is the production branch.");
  }
  if (branchId !== EXPECTED_DEV_BRANCH_ID) {
    throw new Error(
      `Refusing to run: NEON_BRANCH_ID ${branchId} is not the expected development branch.`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    const [dbIdentity] = await prisma.$queryRaw<
      { database: string; db_user: string; server_version: string }[]
    >`SELECT current_database()::text AS database, current_user::text AS db_user, current_setting('server_version') AS server_version`;

    const migrations = await prisma.$queryRaw<
      {
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
        applied_steps_count: number;
      }[]
    >`SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations" ORDER BY started_at`;

    const osfImportCount = await prisma.osfImport.count();
    const osfImportByStatus = await prisma.$queryRaw<
      { status: string; count: bigint }[]
    >`SELECT status::text AS status, COUNT(*)::bigint AS count FROM "OsfImport" GROUP BY status`;
    const requirementsWithImport = await prisma.requirement.count({
      where: { osfImportId: { not: null } },
    });

    const duplicateActiveRequests = await prisma.$queryRaw<
      { requirementId: string; supplierId: string; active_count: bigint }[]
    >`SELECT "requirementId", "supplierId", COUNT(*)::bigint AS active_count
      FROM "SupplierRequest"
      WHERE status IN ('NEW', 'PARTIALLY_RESPONDED', 'RESPONDED')
      GROUP BY "requirementId", "supplierId"
      HAVING COUNT(*) > 1`;

    const duplicateAnyStatusRequests = await prisma.$queryRaw<
      { requirementId: string; supplierId: string; total: bigint }[]
    >`SELECT "requirementId", "supplierId", COUNT(*)::bigint AS total
      FROM "SupplierRequest"
      GROUP BY "requirementId", "supplierId"
      HAVING COUNT(*) > 1`;

    const supplierRequestByStatus = await prisma.$queryRaw<
      { status: string; count: bigint }[]
    >`SELECT status::text AS status, COUNT(*)::bigint AS count FROM "SupplierRequest" GROUP BY status`;

    const duplicateImportBrand = await prisma.$queryRaw<
      { osfImportId: string; brandId: string; count: bigint }[]
    >`SELECT "osfImportId", "brandId", COUNT(*)::bigint AS count
      FROM "Requirement" WHERE "osfImportId" IS NOT NULL
      GROUP BY "osfImportId", "brandId" HAVING COUNT(*) > 1`;

    const enumValues = await prisma.$queryRaw<
      { enum_name: string; value: string; sort: number }[]
    >`SELECT t.typname::text AS enum_name, e.enumlabel::text AS value, e.enumsortorder::float AS sort
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('OsfImportStatus', 'SupplierRequestStatus',
        'OsfImportLineMappingStatus', 'OsfImportDistributionStatus')
      ORDER BY t.typname, e.enumsortorder`;

    const indexes = await prisma.$queryRaw<
      { tablename: string; indexname: string; indexdef: string }[]
    >`SELECT tablename::text AS tablename, indexname::text AS indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('OsfImport', 'Requirement', 'RequirementItem',
          'SupplierRequest', 'IdempotencyKey', 'Brand', 'Product', 'User', 'Company')
      ORDER BY tablename, indexname`;

    const newTablesAlreadyPresent = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name::text AS table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('OsfImportLine', 'OsfImportDistribution', 'IntegrationCredential')`;

    const rowCounts = await prisma.$queryRaw<
      { table_name: string; rows: bigint }[]
    >`SELECT 'Company' AS table_name, COUNT(*)::bigint AS rows FROM "Company"
      UNION ALL SELECT 'Requirement', COUNT(*) FROM "Requirement"
      UNION ALL SELECT 'RequirementItem', COUNT(*) FROM "RequirementItem"
      UNION ALL SELECT 'SupplierRequest', COUNT(*) FROM "SupplierRequest"
      UNION ALL SELECT 'PurchaseOrder', COUNT(*) FROM "PurchaseOrder"
      UNION ALL SELECT 'IdempotencyKey', COUNT(*) FROM "IdempotencyKey"`;

    console.log(
      JSON.stringify(
        {
          identity: {
            neonProjectFile: "holy-art-38015209 (.neon)",
            neonBranch: branchName,
            neonBranchId: branchId,
            isProductionBranch: (branchId as string | null) === PRODUCTION_BRANCH_ID,
            pooledHost,
            directHost,
            ...dbIdentity,
          },
          migrations,
          osfImport: {
            total: osfImportCount,
            byStatus: osfImportByStatus.map((r) => ({
              status: r.status,
              count: Number(r.count),
            })),
            requirementsWithImport,
            duplicateImportBrandPairs: duplicateImportBrand.length,
          },
          supplierRequests: {
            byStatus: supplierRequestByStatus.map((r) => ({
              status: r.status,
              count: Number(r.count),
            })),
            duplicateActivePairs: duplicateActiveRequests.map((r) => ({
              ...r,
              active_count: Number(r.active_count),
            })),
            duplicateAnyStatusPairs: duplicateAnyStatusRequests.map((r) => ({
              ...r,
              total: Number(r.total),
            })),
          },
          enumValues,
          newTablesAlreadyPresent,
          rowCounts: rowCounts.map((r) => ({ ...r, rows: Number(r.rows) })),
          indexes,
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
