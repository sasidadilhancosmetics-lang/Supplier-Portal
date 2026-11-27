/**
 * READ-ONLY preflight snapshot against current DATABASE_URL (must be development parent).
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

config({ path: ".env.local" });

const PRODUCTION = "br-fancy-voice-b33wenqw";
const EXPECTED_DEV = "br-morning-glade-b3odmb6e";

async function main() {
  const branch = process.env.NEON_BRANCH_ID ?? "";
  if (branch === PRODUCTION) throw new Error("Refusing production");
  if (branch !== EXPECTED_DEV) {
    throw new Error(`Expected development parent ${EXPECTED_DEV}, got ${branch}`);
  }
  const sql = neon(process.env.DATABASE_URL!);

  const supplier = await sql`SELECT COUNT(*)::int AS n, COUNT("externalId")::int AS ext FROM "Supplier"`;
  const dups = await sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM "Supplier" WHERE "externalId" IS NOT NULL
      GROUP BY "companyId", "externalId" HAVING COUNT(*) > 1
    ) t`;
  const lines = await sql`
    SELECT id, "osfImportId", "companyId", "lineKey", "mappingStatus"::text AS status,
           "quantityProposed"::text AS proposed, "quantityPlanned"::text AS planned
    FROM "OsfImportLine" ORDER BY id`;
  const reqs = await sql`SELECT COUNT(*)::int AS n FROM "Requirement"`;
  const imports = await sql`SELECT COUNT(*)::int AS n FROM "OsfImport"`;
  const sr = await sql`SELECT COUNT(*)::int AS n FROM "SupplierRequest"`;
  const po = await sql`
    SELECT "orderNumber", status::text AS status FROM "PurchaseOrder"
    WHERE "orderNumber" = 'PO-20261112-E5D42983'`;
  const poAll = await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`;

  const lineHash = createHash("sha256")
    .update(JSON.stringify(lines))
    .digest("hex");

  const snapshot = {
    capturedAt: new Date().toISOString(),
    branchId: branch,
    supplier: supplier[0],
    externalIdDupGroups: dups[0],
    osfImportLineCount: lines.length,
    osfImportLineHash: lineHash,
    lines,
    requirementCount: reqs[0],
    osfImportCount: imports[0],
    supplierRequestCount: sr[0],
    protectedPo: po[0] ?? null,
    purchaseOrderCount: poAll[0],
  };

  writeFileSync(
    "tmp-f2-rehearsal/preflight-snapshot.json",
    JSON.stringify(snapshot, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        branchId: branch,
        lineCount: lines.length,
        lineHash,
        supplier: supplier[0],
        dups: dups[0],
        protectedPo: po[0],
        purchaseOrderCount: poAll[0],
        supplierRequests: sr[0],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
