/**
 * Development apply preflight — READ ONLY against .env.local.
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const PRODUCTION = "br-fancy-voice-b33wenqw";
const DEV = "br-morning-glade-b3odmb6e";

function hostOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return "INVALID_URL";
  }
}

async function main() {
  const branchId = process.env.NEON_BRANCH_ID ?? "";
  const branchName = process.env.NEON_BRANCH ?? "";
  const pooled = process.env.DATABASE_URL;
  const unpooled =
    process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL;

  if (branchId === PRODUCTION || branchName === "production") {
    throw new Error("FATAL: env points at production");
  }
  if (branchId !== DEV) {
    throw new Error(`FATAL: expected ${DEV}, got ${branchId}`);
  }

  const pooledHost = hostOf(pooled);
  const unpooledHost = hostOf(unpooled);
  for (const h of [pooledHost, unpooledHost]) {
    if (!h) throw new Error("Missing DB URL");
    if (h.includes("fancy-voice")) {
      throw new Error(`FATAL: host looks like production: ${h}`);
    }
  }

  const sql = neon(unpooled!);
  const identity = await sql`SELECT current_database() AS db, current_user AS usr`;
  const f2 = await sql`
    SELECT
      to_regclass('public."OsfRequestSuggestion"') IS NOT NULL AS suggestion_table,
      EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'OsfRequestSuggestionMappingStatus'
      ) AS suggestion_enum,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'OsfImportLine_id_companyId_key'
      ) AS line_unique
  `;
  if (f2[0]?.suggestion_table || f2[0]?.suggestion_enum || f2[0]?.line_unique) {
    throw new Error(`FATAL: F2 objects already exist on development: ${JSON.stringify(f2[0])}`);
  }

  const dups = await sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM "Supplier" WHERE "externalId" IS NOT NULL
      GROUP BY "companyId", "externalId" HAVING COUNT(*) > 1
    ) t
  `;
  if ((dups[0] as { n: number }).n > 0) {
    throw new Error("FATAL: duplicate (companyId, externalId)");
  }

  const lines = await sql`
    SELECT id, "osfImportId", "companyId", "lineKey", "mappingStatus"::text AS status,
           "quantityProposed"::text AS proposed, "quantityPlanned"::text AS planned
    FROM "OsfImportLine" ORDER BY id
  `;
  const baseline = {
    capturedAt: new Date().toISOString(),
    branchId,
    branchName,
    pooledHost,
    unpooledHost,
    identity: identity[0],
    f2Absent: f2[0],
    externalIdDupGroups: dups[0],
    suppliers: (
      await sql`SELECT COUNT(*)::int AS n, COUNT("externalId")::int AS ext FROM "Supplier"`
    )[0],
    osfImports: (await sql`SELECT COUNT(*)::int AS n FROM "OsfImport"`)[0],
    osfImportLines: lines.length,
    osfImportLineHash: createHash("sha256")
      .update(JSON.stringify(lines))
      .digest("hex"),
    requirements: (await sql`SELECT COUNT(*)::int AS n FROM "Requirement"`)[0],
    supplierRequests: (
      await sql`SELECT COUNT(*)::int AS n FROM "SupplierRequest"`
    )[0],
    notifications: (await sql`SELECT COUNT(*)::int AS n FROM "Notification"`)[0],
    purchaseOrders: (await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`)[0],
    protectedPo: (
      await sql`
        SELECT "orderNumber", status::text AS status FROM "PurchaseOrder"
        WHERE "orderNumber" = 'PO-20261112-E5D42983'
      `
    )[0],
    migrations: await sql`
      SELECT migration_name, finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS rolled_back
      FROM "_prisma_migrations"
      ORDER BY started_at
    `,
  };

  const proposed = readFileSync("prisma/proposed/phase-f2/migration.sql");
  baseline["proposedSqlSha256"] = createHash("sha256")
    .update(proposed)
    .digest("hex");

  writeFileSync(
    "tmp-f2-dev-apply/preflight-baseline.json",
    JSON.stringify(baseline, null, 2),
  );
  console.log(JSON.stringify(baseline, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
