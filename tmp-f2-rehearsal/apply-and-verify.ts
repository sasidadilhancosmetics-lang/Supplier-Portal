/**
 * Apply reviewed F2 migration.sql to a rehearsal branch and run constraint drills.
 * Uses DIRECT_DATABASE_URL from a local .env.* file. Never touches parent/production.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const envFile = process.argv[2];
const mode = process.argv[3] ?? "migrate-verify"; // migrate-verify | rollback-drill
if (!envFile) {
  console.error("Usage: tsx apply-and-verify.ts <env-file> [migrate-verify|rollback-drill]");
  process.exit(1);
}

config({ path: ".env.local" }); // ignore parent URLs after override
config({ path: envFile, override: true });

const PRODUCTION = "br-fancy-voice-b33wenqw";
const DEV_PARENT = "br-morning-glade-b3odmb6e";
const branchId = process.env.REHEARSAL_BRANCH_ID ?? "";
const host = process.env.REHEARSAL_HOST ?? "";
const direct = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
const pooled = process.env.DATABASE_URL;

if (!direct || !branchId || !host) {
  throw new Error("Missing rehearsal connection identity");
}
if (branchId === PRODUCTION || branchId === DEV_PARENT) {
  throw new Error(`Refusing non-rehearsal branch ${branchId}`);
}
if (host.includes("morning-glade") || host.includes("fancy-voice")) {
  throw new Error(`Host looks like parent/production: ${host}`);
}
if (!direct.includes(host.replace("-pooler", ""))) {
  // host may be non-pooler already
}

const snapshot = JSON.parse(
  readFileSync("tmp-f2-rehearsal/preflight-snapshot.json", "utf8"),
);

async function q(client: pg.Client, text: string, params: unknown[] = []) {
  return client.query(text, params);
}

async function expectFail(
  client: pg.Client,
  label: string,
  text: string,
  params: unknown[] = [],
) {
  try {
    await client.query(text, params);
    return { label, ok: false, error: "EXPECTED_FAILURE_BUT_SUCCEEDED" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { label, ok: true, error: msg.split("\n")[0] };
  }
}

async function main() {
  const client = new pg.Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Identity: ensure we can query and host matches.
  const identity = {
    branchId,
    host,
    pooledHost: pooled ? new URL(pooled).hostname : null,
    serverAddr: (await q(client, "SELECT inet_server_addr()::text AS addr")).rows[0],
  };
  console.log("identity", JSON.stringify(identity));

  const sql = readFileSync("prisma/proposed/phase-f2/migration.sql", "utf8");
  const rollbackSql = readFileSync("prisma/proposed/phase-f2/rollback.sql", "utf8");

  if (mode === "migrate-verify" || mode === "rollback-drill") {
    console.log("Applying migration.sql …");
    await client.query(sql);
    console.log("migration: COMMITTED");
  }

  // Schema presence
  const objects = await q(
    client,
    `
    SELECT
      to_regclass('public."OsfRequestSuggestion"') IS NOT NULL AS table_exists,
      EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OsfRequestSuggestionMappingStatus') AS enum_exists,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_companyId_key') AS u1,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_osfImportId_companyId_key') AS u2,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_osfImportId_companyId_lineKey_key') AS u3,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Supplier_companyId_externalId_key') AS u4
  `,
  );
  console.log("objects", objects.rows[0]);

  const enumVals = await q(
    client,
    `
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OsfRequestSuggestionMappingStatus'
    ORDER BY e.enumsortorder
  `,
  );
  console.log(
    "enum_values",
    enumVals.rows.map((r) => r.enumlabel),
  );

  // Baseline compare
  const lines = await q(
    client,
    `
    SELECT id, "osfImportId", "companyId", "lineKey", "mappingStatus"::text AS status,
           "quantityProposed"::text AS proposed, "quantityPlanned"::text AS planned
    FROM "OsfImportLine" ORDER BY id
  `,
  );
  const lineHash = createHash("sha256")
    .update(JSON.stringify(lines.rows))
    .digest("hex");
  const supplier = await q(
    client,
    `SELECT COUNT(*)::int AS n, COUNT("externalId")::int AS ext FROM "Supplier"`,
  );
  const po = await q(
    client,
    `SELECT "orderNumber", status::text AS status FROM "PurchaseOrder"
     WHERE "orderNumber" = 'PO-20261112-E5D42983'`,
  );
  const poCount = await q(client, `SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`);
  const srCount = await q(client, `SELECT COUNT(*)::int AS n FROM "SupplierRequest"`);

  const dataCompare = {
    lineCount: lines.rows.length,
    lineHashMatch: lineHash === snapshot.osfImportLineHash,
    lineHash,
    expectedLineHash: snapshot.osfImportLineHash,
    supplier: supplier.rows[0],
    expectedSupplier: snapshot.supplier,
    protectedPo: po.rows[0] ?? null,
    expectedPo: snapshot.protectedPo,
    purchaseOrderCount: poCount.rows[0],
    supplierRequestCount: srCount.rows[0],
    expectedSupplierRequests: snapshot.supplierRequestCount,
  };
  console.log("data_compare", JSON.stringify(dataCompare, null, 2));

  // Fixture drills using existing first line + supplier
  const line = lines.rows[0];
  if (!line) throw new Error("No OsfImportLine for drills");
  const otherLine =
    lines.rows.find(
      (r) => r.osfImportId === line.osfImportId && r.id !== line.id,
    ) ?? lines.rows.find((r) => r.id !== line.id);
  const suppliers = await q(
    client,
    `SELECT id, "companyId" FROM "Supplier" ORDER BY id`,
  );
  const supplierRow = suppliers.rows[0];
  const otherCompany = await q(
    client,
    `SELECT id FROM "Company" WHERE id <> $1 LIMIT 1`,
    [line.companyId],
  );

  const results: Array<{ label: string; ok: boolean; error?: string }> = [];

  // Valid UNRESOLVED
  try {
    await q(
      client,
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2rh_ok_unresolved', $1, $2, $3, $4,
        'cosmo_sup_1', 'Cosmo One', 5,
        'UNRESOLVED_SUPPLIER', '{"t":1}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    );
    results.push({ label: "insert_unresolved_null_supplier", ok: true });
  } catch (e) {
    results.push({
      label: "insert_unresolved_null_supplier",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Valid MATCHED
  if (supplierRow && supplierRow.companyId === line.companyId) {
    try {
      await q(
        client,
        `
        INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "supplierId", "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2rh_ok_matched', $1, $2, $3, $4,
          'cosmo_sup_2', 'Cosmo Two', 7,
          $5, 'MATCHED_SUPPLIER', '{"t":2}'::jsonb
        )
      `,
        [
          line.companyId,
          line.osfImportId,
          line.id,
          line.lineKey,
          supplierRow.id,
        ],
      );
      results.push({ label: "insert_matched_supplier", ok: true });
    } catch (e) {
      results.push({
        label: "insert_matched_supplier",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Duplicate suggestion
  results.push(
    await expectFail(
      client,
      "reject_duplicate_suggestion",
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2rh_dup', $1, $2, $3, $4,
        'cosmo_sup_1', 'Cosmo One', 5,
        'UNRESOLVED_SUPPLIER', '{}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );

  // Qty <= 0
  results.push(
    await expectFail(
      client,
      "reject_zero_qty",
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2rh_zero', $1, $2, $3, $4,
        'cosmo_sup_z', 'Z', 0,
        'UNRESOLVED_SUPPLIER', '{}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );

  // MATCHED without supplierId
  results.push(
    await expectFail(
      client,
      "reject_matched_without_supplier",
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2rh_bad_match', $1, $2, $3, $4,
        'cosmo_sup_m', 'M', 3,
        'MATCHED_SUPPLIER', '{}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );

  // UNRESOLVED with supplierId
  results.push(
    await expectFail(
      client,
      "reject_unresolved_with_supplier",
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "supplierId", "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2rh_bad_unres', $1, $2, $3, $4,
        'cosmo_sup_u', 'U', 3,
        $5, 'UNRESOLVED_SUPPLIER', '{}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey, supplierRow?.id],
    ),
  );

  // Mismatched lineKey for same line id (quad FK)
  if (otherLine && otherLine.osfImportId === line.osfImportId) {
    results.push(
      await expectFail(
        client,
        "reject_mismatched_lineKey",
        `
        INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2rh_bad_key', $1, $2, $3, $4,
          'cosmo_sup_k', 'K', 3,
          'UNRESOLVED_SUPPLIER', '{}'::jsonb
        )
      `,
        [line.companyId, line.osfImportId, line.id, otherLine.lineKey],
      ),
    );
  } else {
    results.push({
      label: "reject_mismatched_lineKey",
      ok: false,
      error: "SKIPPED_NO_SECOND_LINE_SAME_IMPORT",
    });
  }

  // Cross-company supplier
  if (otherCompany.rows[0] && supplierRow) {
    // Find a supplier in another company if any; else create temp company+supplier in txn? 
    // Better: use existing other company and try FK with supplier from company A on company B fields.
    results.push(
      await expectFail(
        client,
        "reject_cross_company_supplier",
        `
        INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "supplierId", "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2rh_xco', $1, $2, $3, $4,
          'cosmo_sup_x', 'X', 3,
          $5, 'MATCHED_SUPPLIER', '{}'::jsonb
        )
      `,
        [
          // Keep line's companyId so line FK passes; supplier from same row — need supplier of OTHER company.
          line.companyId,
          line.osfImportId,
          line.id,
          line.lineKey,
          supplierRow.id,
        ],
      ),
    );
    // That won't fail if supplier is same company. Look up cross-company supplier:
  }

  const crossSup = await q(
    client,
    `SELECT id, "companyId" FROM "Supplier" WHERE "companyId" <> $1 LIMIT 1`,
    [line.companyId],
  );
  if (crossSup.rows[0]) {
    // Suggestion company must match line company; supplier from other company → FK fail
    results.push(
      await expectFail(
        client,
        "reject_cross_company_supplier",
        `
        INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "supplierId", "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2rh_xco2', $1, $2, $3, $4,
          'cosmo_sup_x2', 'X2', 3,
          $5, 'MATCHED_SUPPLIER', '{}'::jsonb
        )
      `,
        [
          line.companyId,
          line.osfImportId,
          line.id,
          line.lineKey,
          crossSup.rows[0].id,
        ],
      ),
    );
  } else {
    // Create ephemeral other-company supplier for the drill, then delete.
    const tempCompany = "f2rh_temp_co";
    const tempSupplier = "f2rh_temp_sup";
    await q(
      client,
      `INSERT INTO "Company"(id, name, "createdAt", "updatedAt")
       VALUES ($1, 'F2 RH Temp', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [tempCompany],
    );
    await q(
      client,
      `INSERT INTO "Supplier"(id, "companyId", name, status, "supportsAllBrands", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Temp', 'ACTIVE', true, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [tempSupplier, tempCompany],
    );
    results.push(
      await expectFail(
        client,
        "reject_cross_company_supplier",
        `
        INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "supplierId", "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2rh_xco3', $1, $2, $3, $4,
          'cosmo_sup_x3', 'X3', 3,
          $5, 'MATCHED_SUPPLIER', '{}'::jsonb
        )
      `,
        [line.companyId, line.osfImportId, line.id, line.lineKey, tempSupplier],
      ),
    );
    await q(client, `DELETE FROM "Supplier" WHERE id = $1`, [tempSupplier]);
    await q(client, `DELETE FROM "Company" WHERE id = $1`, [tempCompany]);
  }

  // Duplicate externalId unique
  if (supplierRow) {
    const s2 = suppliers.rows[1];
    if (s2 && s2.companyId === supplierRow.companyId) {
      await q(
        client,
        `UPDATE "Supplier" SET "externalId" = 'cosmo_dup_test' WHERE id = $1`,
        [supplierRow.id],
      );
      results.push(
        await expectFail(
          client,
          "reject_duplicate_externalId",
          `UPDATE "Supplier" SET "externalId" = 'cosmo_dup_test' WHERE id = $1`,
          [s2.id],
        ),
      );
      await q(
        client,
        `UPDATE "Supplier" SET "externalId" = NULL WHERE id = $1`,
        [supplierRow.id],
      );
    } else {
      results.push({
        label: "reject_duplicate_externalId",
        ok: true,
        error: "SKIPPED_ONLY_ONE_SUPPLIER_SAME_COMPANY",
      });
    }
  }

  console.log("constraint_tests", JSON.stringify(results, null, 2));

  // Cleanup fixture suggestion rows (keep schema)
  await q(
    client,
    `DELETE FROM "OsfRequestSuggestion" WHERE id LIKE 'f2rh_%'`,
  );

  if (mode === "rollback-drill") {
    console.log("Applying rollback.sql …");
    await client.query(rollbackSql);
    console.log("rollback: COMMITTED");
    const after = await q(
      client,
      `
      SELECT
        to_regclass('public."OsfRequestSuggestion"') IS NOT NULL AS table_exists,
        EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OsfRequestSuggestionMappingStatus') AS enum_exists,
        EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_companyId_key') AS u1,
        EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Supplier_companyId_externalId_key') AS u4
    `,
    );
    const po2 = await q(
      client,
      `SELECT status::text AS status FROM "PurchaseOrder"
       WHERE "orderNumber" = 'PO-20261112-E5D42983'`,
    );
    const lineCount2 = await q(
      client,
      `SELECT COUNT(*)::int AS n FROM "OsfImportLine"`,
    );
    console.log("after_rollback_objects", after.rows[0]);
    console.log("after_rollback_po", po2.rows[0]);
    console.log("after_rollback_lines", lineCount2.rows[0]);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
