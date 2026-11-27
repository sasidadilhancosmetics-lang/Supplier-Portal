/**
 * Read-only Phase B preflight. Runs every query inside a READ ONLY transaction.
 * Refuses to run unless NEON_BRANCH_ID is the development branch.
 * Usage: npx tsx tmp-phase-b-preflight-readonly.ts
 */
import { config } from "dotenv";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const DEV_BRANCH_ID = "br-morning-glade-b3odmb6e";
const PROD_BRANCH_ID = "br-fancy-voice-b33wenqw";

async function main() {
  const branchId = process.env.NEON_BRANCH_ID ?? "";
  const url = process.env.DATABASE_URL_UNPOOLED ?? "";
  if (branchId !== DEV_BRANCH_ID) {
    throw new Error(`Refusing: NEON_BRANCH_ID=${branchId || "<unset>"} is not development`);
  }
  if (!url || url.includes(PROD_BRANCH_ID)) {
    throw new Error("Refusing: unpooled URL missing or references production");
  }
  const host = /@([^/:]+)/.exec(url)?.[1] ?? "<unparsed>";

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const out: Record<string, unknown> = { branchId, host };
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    const q = async (name: string, sql: string) => {
      const res = await client.query(sql);
      out[name] = res.rows;
    };

    await q(
      "server",
      `SELECT current_database() AS db, current_user AS "user", version() AS version,
              current_setting('server_version_num') AS version_num,
              current_setting('transaction_read_only') AS read_only`,
    );
    await q(
      "migrations",
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
         FROM "_prisma_migrations" ORDER BY started_at`,
    );
    await q(
      "osfImportCounts",
      `SELECT status::text, count(*)::int FROM "OsfImport" GROUP BY status
       UNION ALL SELECT 'TOTAL', count(*)::int FROM "OsfImport"`,
    );
    await q(
      "requirementCounts",
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE "osfImportId" IS NOT NULL)::int AS with_import
         FROM "Requirement"`,
    );
    await q(
      "requirementImportBrandDuplicates",
      `SELECT "osfImportId", "brandId", count(*)::int
         FROM "Requirement" WHERE "osfImportId" IS NOT NULL
        GROUP BY 1, 2 HAVING count(*) > 1`,
    );
    await q(
      "supplierRequestByStatus",
      `SELECT status::text, count(*)::int FROM "SupplierRequest" GROUP BY status ORDER BY status`,
    );
    await q(
      "duplicateActiveSupplierRequests",
      `SELECT "requirementId", "supplierId", count(*)::int AS n,
              array_agg(id ORDER BY "createdAt") AS ids,
              array_agg(status::text ORDER BY "createdAt") AS statuses
         FROM "SupplierRequest"
        WHERE status IN ('NEW', 'PARTIALLY_RESPONDED', 'RESPONDED')
        GROUP BY 1, 2 HAVING count(*) > 1`,
    );
    await q(
      "anySupplierRequestRepeatPairs",
      `SELECT "requirementId", "supplierId", count(*)::int AS n,
              array_agg(status::text ORDER BY "createdAt") AS statuses
         FROM "SupplierRequest" GROUP BY 1, 2 HAVING count(*) > 1`,
    );
    await q(
      "supplierRequestCompanyMismatch",
      `SELECT sr.id FROM "SupplierRequest" sr
         JOIN "Requirement" r ON r.id = sr."requirementId"
        WHERE r."companyId" <> sr."companyId" OR r."brandId" <> sr."brandId"`,
    );
    await q(
      "indexes",
      `SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('SupplierRequest', 'OsfImport', 'Requirement', 'RequirementItem',
                            'IdempotencyKey', 'Brand', 'Product', 'Company', 'User')
        ORDER BY tablename, indexname`,
    );
    await q(
      "enums",
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('OsfImportStatus', 'SupplierRequestStatus')
        GROUP BY t.typname`,
    );
    await q(
      "newObjectsAlreadyPresent",
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('OsfImportLine', 'OsfImportDistribution', 'IntegrationCredential',
                            'SupplierRequest_active_requirement_supplier_key')
       UNION ALL
       SELECT typname FROM pg_type
        WHERE typname IN ('OsfImportLineMappingStatus', 'OsfImportDistributionStatus')`,
    );
    await q(
      "osfImportColumns",
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'OsfImport' ORDER BY ordinal_position`,
    );
    await q(
      "idempotencyScopes",
      `SELECT split_part(scope, ':', 1) AS scope_prefix, count(*)::int
         FROM "IdempotencyKey" GROUP BY 1 ORDER BY 1`,
    );
    await q(
      "tableSizes",
      `SELECT relname, n_live_tup::int FROM pg_stat_user_tables
        WHERE relname IN ('SupplierRequest', 'Requirement', 'OsfImport', 'RequirementItem')`,
    );

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
