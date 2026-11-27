/**
 * Post-apply verification on development (.env.local). Includes rollback-safe drills.
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

config({ path: ".env.local" });

const DEV = "br-morning-glade-b3odmb6e";
const PRODUCTION = "br-fancy-voice-b33wenqw";

async function expectFail(client: pg.Client, label: string, sql: string, params: unknown[] = []) {
  try {
    await client.query(sql, params);
    return { label, ok: false, error: "EXPECTED_FAIL_BUT_SUCCEEDED" };
  } catch (e) {
    return {
      label,
      ok: true,
      error: e instanceof Error ? e.message.split("\n")[0] : String(e),
    };
  }
}

async function main() {
  const branchId = process.env.NEON_BRANCH_ID ?? "";
  if (branchId !== DEV) throw new Error(`Wrong branch ${branchId}`);
  if (branchId === PRODUCTION) throw new Error("production");

  const direct =
    process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL!;
  const host = new URL(direct).hostname;
  if (host.includes("fancy-voice")) throw new Error("production host");

  const baseline = JSON.parse(
    readFileSync("tmp-f2-dev-apply/preflight-baseline.json", "utf8"),
  );

  const client = new pg.Client({
    connectionString: direct,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const migration = await client.query(
    `SELECT migration_name, finished_at, rolled_back_at
     FROM "_prisma_migrations"
     WHERE migration_name = '20261113134000_phase_f2_request_suggestions'`,
  );

  const objects = await client.query(`
    SELECT
      to_regclass('public."OsfRequestSuggestion"') IS NOT NULL AS table_exists,
      EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OsfRequestSuggestionMappingStatus') AS enum_exists,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_companyId_key') AS u1,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_osfImportId_companyId_key') AS u2,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'OsfImportLine_id_osfImportId_companyId_lineKey_key') AS u3,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Supplier_companyId_externalId_key') AS u4
  `);

  const fks = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"OsfRequestSuggestion"'::regclass AND contype = 'f'
    ORDER BY 1
  `);
  const chks = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"OsfRequestSuggestion"'::regclass AND contype = 'c'
    ORDER BY 1
  `);

  const lines = await client.query(`
    SELECT id, "osfImportId", "companyId", "lineKey", "mappingStatus"::text AS status,
           "quantityProposed"::text AS proposed, "quantityPlanned"::text AS planned
    FROM "OsfImportLine" ORDER BY id
  `);
  const lineHash = createHash("sha256")
    .update(JSON.stringify(lines.rows))
    .digest("hex");

  const counts = {
    suppliers: (
      await client.query(
        `SELECT COUNT(*)::int AS n, COUNT("externalId")::int AS ext FROM "Supplier"`,
      )
    ).rows[0],
    osfImports: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "OsfImport"`)
    ).rows[0],
    requirements: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "Requirement"`)
    ).rows[0],
    supplierRequests: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "SupplierRequest"`)
    ).rows[0],
    notifications: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "Notification"`)
    ).rows[0],
    purchaseOrders: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`)
    ).rows[0],
    suggestions: (
      await client.query(`SELECT COUNT(*)::int AS n FROM "OsfRequestSuggestion"`)
    ).rows[0],
    protectedPo: (
      await client.query(
        `SELECT "orderNumber", status::text AS status FROM "PurchaseOrder"
         WHERE "orderNumber" = 'PO-20261112-E5D42983'`,
      )
    ).rows[0],
  };

  const line = lines.rows[0];
  const otherLine = lines.rows.find(
    (r) => r.osfImportId === line.osfImportId && r.id !== line.id,
  );
  const suppliers = (
    await client.query(`SELECT id, "companyId" FROM "Supplier" ORDER BY id`)
  ).rows;
  const supplierRow = suppliers.find((s) => s.companyId === line.companyId);

  const drills: Array<{ label: string; ok: boolean; error?: string }> = [];

  await client.query(
    `
    INSERT INTO "OsfRequestSuggestion" (
      id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
      "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
      "mappingStatus", "sourceSnapshot"
    ) VALUES (
      'f2dev_unres', $1, $2, $3, $4,
      'cosmo_dev_1', 'Dev One', 5,
      'UNRESOLVED_SUPPLIER', '{}'::jsonb
    )
  `,
    [line.companyId, line.osfImportId, line.id, line.lineKey],
  );
  drills.push({ label: "insert_unresolved", ok: true });

  if (supplierRow) {
    await client.query(
      `
      INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "supplierId", "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2dev_match', $1, $2, $3, $4,
        'cosmo_dev_2', 'Dev Two', 7,
        $5, 'MATCHED_SUPPLIER', '{}'::jsonb
      )
    `,
      [line.companyId, line.osfImportId, line.id, line.lineKey, supplierRow.id],
    );
    drills.push({ label: "insert_matched", ok: true });
  }

  drills.push(
    await expectFail(
      client,
      "reject_duplicate",
      `INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2dev_dup', $1, $2, $3, $4,
        'cosmo_dev_1', 'Dev One', 5,
        'UNRESOLVED_SUPPLIER', '{}'::jsonb
      )`,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );
  drills.push(
    await expectFail(
      client,
      "reject_zero_qty",
      `INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2dev_zero', $1, $2, $3, $4,
        'cosmo_dev_z', 'Z', 0,
        'UNRESOLVED_SUPPLIER', '{}'::jsonb
      )`,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );
  drills.push(
    await expectFail(
      client,
      "reject_matched_without_supplier",
      `INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2dev_badm', $1, $2, $3, $4,
        'cosmo_dev_m', 'M', 3,
        'MATCHED_SUPPLIER', '{}'::jsonb
      )`,
      [line.companyId, line.osfImportId, line.id, line.lineKey],
    ),
  );

  if (otherLine) {
    drills.push(
      await expectFail(
        client,
        "reject_lineKey_mismatch",
        `INSERT INTO "OsfRequestSuggestion" (
          id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
          "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
          "mappingStatus", "sourceSnapshot"
        ) VALUES (
          'f2dev_key', $1, $2, $3, $4,
          'cosmo_dev_k', 'K', 3,
          'UNRESOLVED_SUPPLIER', '{}'::jsonb
        )`,
        [line.companyId, line.osfImportId, line.id, otherLine.lineKey],
      ),
    );
  }

  // Cross-company supplier
  const tempCo = "f2dev_temp_co";
  const tempSup = "f2dev_temp_sup";
  await client.query(
    `INSERT INTO "Company"(id, name, "createdAt", "updatedAt") VALUES ($1,'T',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [tempCo],
  );
  await client.query(
    `INSERT INTO "Supplier"(id,"companyId",name,status,"supportsAllBrands","createdAt","updatedAt")
     VALUES ($1,$2,'T','ACTIVE',true,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [tempSup, tempCo],
  );
  drills.push(
    await expectFail(
      client,
      "reject_cross_company_supplier",
      `INSERT INTO "OsfRequestSuggestion" (
        id, "companyId", "osfImportId", "osfImportLineId", "lineKey",
        "cosmoSupplierId", "cosmoSupplierName", "suggestedRequestQty",
        "supplierId", "mappingStatus", "sourceSnapshot"
      ) VALUES (
        'f2dev_xco', $1, $2, $3, $4,
        'cosmo_dev_x', 'X', 3,
        $5, 'MATCHED_SUPPLIER', '{}'::jsonb
      )`,
      [line.companyId, line.osfImportId, line.id, line.lineKey, tempSup],
    ),
  );
  await client.query(`DELETE FROM "Supplier" WHERE id = $1`, [tempSup]);
  await client.query(`DELETE FROM "Company" WHERE id = $1`, [tempCo]);

  // Duplicate externalId
  if (supplierRow && suppliers.filter((s) => s.companyId === supplierRow.companyId).length >= 2) {
    const s2 = suppliers.find(
      (s) => s.companyId === supplierRow.companyId && s.id !== supplierRow.id,
    )!;
    await client.query(`UPDATE "Supplier" SET "externalId" = 'dup_dev' WHERE id = $1`, [
      supplierRow.id,
    ]);
    drills.push(
      await expectFail(
        client,
        "reject_duplicate_externalId",
        `UPDATE "Supplier" SET "externalId" = 'dup_dev' WHERE id = $1`,
        [s2.id],
      ),
    );
    await client.query(`UPDATE "Supplier" SET "externalId" = NULL WHERE id = $1`, [
      supplierRow.id,
    ]);
  }

  // Cleanup drills
  await client.query(`DELETE FROM "OsfRequestSuggestion" WHERE id LIKE 'f2dev_%'`);

  const report = {
    branchId,
    host,
    migration: migration.rows[0],
    objects: objects.rows[0],
    fks: fks.rows.map((r) => r.conname),
    checks: chks.rows.map((r) => r.conname),
    dataCompare: {
      lineHashMatch: lineHash === baseline.osfImportLineHash,
      lineCount: lines.rows.length,
      expectedLineCount: baseline.osfImportLines,
      suppliers: counts.suppliers,
      expectedSuppliers: baseline.suppliers,
      osfImports: counts.osfImports,
      expectedImports: baseline.osfImports,
      requirements: counts.requirements,
      expectedRequirements: baseline.requirements,
      supplierRequests: counts.supplierRequests,
      expectedSupplierRequests: baseline.supplierRequests,
      notifications: counts.notifications,
      expectedNotifications: baseline.notifications,
      purchaseOrders: counts.purchaseOrders,
      expectedPurchaseOrders: baseline.purchaseOrders,
      suggestionsAfterCleanup: counts.suggestions,
      protectedPo: counts.protectedPo,
    },
    drills,
    allDrillsOk: drills.every((d) => d.ok),
  };

  writeFileSync(
    "tmp-f2-dev-apply/post-verify.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await client.end();
  if (!report.allDrillsOk || !report.dataCompare.lineHashMatch) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
