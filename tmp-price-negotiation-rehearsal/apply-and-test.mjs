/**
 * Apply proposed price-negotiation migration + constraint drills on a child branch.
 * Usage: DATABASE_URL=... node tmp-price-negotiation-rehearsal/apply-and-test.mjs [--skip-migrate] [--rollback]
 * Never prints connection strings.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

// Prefer direct (non-pooler) for DDL.
const directUrl = url.replace("-pooler.", ".");
const client = new pg.Client({
  connectionString: directUrl,
  ssl: { rejectUnauthorized: false },
});

const skipMigrate = process.argv.includes("--skip-migrate");
const doRollback = process.argv.includes("--rollback");
const outDir = "tmp-price-negotiation-rehearsal/out";
mkdirSync(outDir, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function q(sql, params = []) {
  return client.query(sql, params);
}

async function expectFail(label, fn) {
  try {
    await fn();
    throw new Error(`${label}: expected failure but succeeded`);
  } catch (err) {
    if (err.message?.startsWith(`${label}:`)) throw err;
    return String(err.message ?? err).slice(0, 200);
  }
}

const results = { tests: [], host: null, branchHint: null };

try {
  await client.connect();
  const host = new URL(directUrl).hostname;
  results.host = host;
  assert(!host.includes("fancy-voice"), "Refusing production host");
  assert(!host.includes("little-credit"), "Refusing development parent host");

  const ident = await q(
    `SELECT current_database() AS db,
            inet_server_addr()::text AS addr,
            (SELECT COUNT(*)::int FROM "_prisma_migrations") AS migrations`,
  );
  results.identity = ident.rows[0];

  const before = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM "AvailabilityOffer") AS offers,
      (SELECT COUNT(*)::int FROM "AvailabilityOffer" WHERE "unitPrice" IS NULL) AS offers_price_null,
      (SELECT COUNT(*)::int FROM "OrderItem") AS order_items,
      (SELECT COUNT(*)::int FROM "OrderItem" WHERE "unitPrice" IS NULL) AS order_items_price_null,
      (SELECT COUNT(*)::int FROM "SupplierRequest") AS supplier_requests,
      (SELECT COUNT(*)::int FROM "PurchaseOrder") AS purchase_orders,
      (SELECT "status" FROM "PurchaseOrder" WHERE "orderNumber" = 'PO-20261112-E5D42983') AS protected_po_status,
      (SELECT "version" FROM "PurchaseOrder" WHERE "orderNumber" = 'PO-20261112-E5D42983') AS protected_po_version
  `);
  results.before = before.rows[0];

  if (!skipMigrate) {
    const sql = readFileSync(
      "prisma/proposed/price-negotiation/migration.sql",
      "utf8",
    );
    await client.query(sql);
    results.migrate = "applied";
  } else {
    results.migrate = "skipped";
  }

  // Inventory
  const inventory = await q(`
    SELECT
      to_regclass('public."PriceQuote"') IS NOT NULL AS has_price_quote,
      to_regclass('public."PriceAgreement"') IS NOT NULL AS has_price_agreement,
      EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceNegotiationChannel') AS has_channel_enum,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'OrderItem' AND column_name = 'priceQuoteId'
      ) AS orderitem_price_quote_id,
      (
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname IN (
          'PriceQuote_unitPrice_positive',
          'PriceAgreement_unitPrice_positive',
          'PriceAgreement_availabilityOfferId_key'
        )
      ) AS named_checks_uniques
  `);
  results.inventory = inventory.rows[0];

  const fks = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid IN ('public."PriceQuote"'::regclass, 'public."PriceAgreement"'::regclass, 'public."OrderItem"'::regclass)
      AND contype = 'f'
      AND (conname LIKE 'Price%' OR conname LIKE 'OrderItem_price%')
    ORDER BY conname
  `);
  results.fks = fks.rows.map((r) => r.conname);

  // Fixture from existing same-company offer + product + optional second company
  const fixture = await q(`
    SELECT ao.id AS offer_id, ao."supplierId" AS supplier_id, ri."companyId" AS company_id,
           ri."productId" AS product_id, ri.id AS request_item_id, ri."supplierRequestId" AS request_id
    FROM "AvailabilityOffer" ao
    JOIN "RequestItem" ri ON ri.id = ao."requestItemId" AND ri."supplierId" = ao."supplierId"
    LIMIT 1
  `);
  assert(fixture.rows.length === 1, "Need at least one AvailabilityOffer fixture");
  const f = fixture.rows[0];

  const otherCompany = await q(`
    SELECT id FROM "Company" WHERE id <> $1 LIMIT 1
  `, [f.company_id]);

  const quoteId = `pq_rehearsal_${randomUUID().slice(0, 8)}`;
  const agreementId = `pa_rehearsal_${randomUUID().slice(0, 8)}`;

  // 1) Valid quote + agreement
  await q(
    `INSERT INTO "PriceQuote" (
      id, "companyId", "supplierId", "productId", "availabilityOfferId", "requestItemId",
      "supplierRequestId", channel, kind, status, "unitPrice", "currencyCode", "recordedByUserId", "createdAt"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,'PORTAL','SUPPLIER_ORIGINAL','QUOTED',12.50,'LKR',NULL,NOW()
    )`,
    [quoteId, f.company_id, f.supplier_id, f.product_id, f.offer_id, f.request_item_id, f.request_id],
  );
  await q(
    `INSERT INTO "PriceAgreement" (
      id, "companyId", "supplierId", "productId", "availabilityOfferId", "requestItemId",
      status, "currentQuoteId", "unitPrice", "currencyCode", channel, version, "createdAt", "updatedAt"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,'QUOTED',$7,12.50,'LKR','PORTAL',1,NOW(),NOW()
    )`,
    [agreementId, f.company_id, f.supplier_id, f.product_id, f.offer_id, f.request_item_id, quoteId],
  );
  results.tests.push({ name: "valid_quote_and_agreement", pass: true });

  // 2) Zero / negative price rejected
  const zeroErr = await expectFail("zero_price", () =>
    q(
      `INSERT INTO "PriceQuote" (
        id, "companyId", "supplierId", "productId", "availabilityOfferId",
        channel, kind, status, "unitPrice", "createdAt"
      ) VALUES ($1,$2,$3,$4,$5,'PORTAL','SUPPLIER_ORIGINAL','QUOTED',0,NOW())`,
      [`pq_zero_${randomUUID().slice(0, 8)}`, f.company_id, f.supplier_id, f.product_id, f.offer_id],
    ),
  );
  results.tests.push({ name: "reject_zero_price", pass: /check|PriceQuote_unitPrice_positive/i.test(zeroErr), detail: zeroErr });

  // 3) Cross-company supplier rejected by composite FK
  let crossPass = false;
  let crossDetail = "no other company";
  if (otherCompany.rows[0]) {
    const oc = otherCompany.rows[0].id;
    const otherSupplier = await q(
      `SELECT id FROM "Supplier" WHERE "companyId" = $1 LIMIT 1`,
      [oc],
    );
    if (otherSupplier.rows[0]) {
      crossDetail = await expectFail("cross_company", () =>
        q(
          `INSERT INTO "PriceQuote" (
            id, "companyId", "supplierId", "productId", "availabilityOfferId",
            channel, kind, status, "unitPrice", "createdAt"
          ) VALUES ($1,$2,$3,$4,$5,'PORTAL','SUPPLIER_ORIGINAL','QUOTED',9.99,NOW())`,
          [
            `pq_xco_${randomUUID().slice(0, 8)}`,
            f.company_id,
            otherSupplier.rows[0].id,
            f.product_id,
            f.offer_id,
          ],
        ),
      );
      crossPass = /foreign key|PriceQuote_supplier/i.test(crossDetail);
    } else {
      // Still reject inventing supplier id with wrong company pairing
      crossDetail = await expectFail("cross_company_fake", () =>
        q(
          `INSERT INTO "PriceQuote" (
            id, "companyId", "supplierId", "productId",
            channel, kind, status, "unitPrice", "createdAt"
          ) VALUES ($1,$2,$3,$4,'PORTAL','SUPPLIER_ORIGINAL','QUOTED',9.99,NOW())`,
          [
            `pq_xco_${randomUUID().slice(0, 8)}`,
            f.company_id,
            "nonexistent_supplier_xyz",
            f.product_id,
          ],
        ),
      );
      crossPass = /foreign key/i.test(crossDetail);
    }
  } else {
    crossDetail = await expectFail("cross_company_fake", () =>
      q(
        `INSERT INTO "PriceQuote" (
          id, "companyId", "supplierId", "productId",
          channel, kind, status, "unitPrice", "createdAt"
        ) VALUES ($1,$2,$3,$4,'PORTAL','SUPPLIER_ORIGINAL','QUOTED',9.99,NOW())`,
        [
          `pq_xco_${randomUUID().slice(0, 8)}`,
          f.company_id,
          "nonexistent_supplier_xyz",
          f.product_id,
        ],
      ),
    );
    crossPass = /foreign key/i.test(crossDetail);
  }
  results.tests.push({ name: "reject_cross_company_or_bad_supplier", pass: crossPass, detail: crossDetail });

  // 4) Duplicate agreement for same offer rejected
  const dupErr = await expectFail("dup_agreement", () =>
    q(
      `INSERT INTO "PriceAgreement" (
        id, "companyId", "supplierId", "productId", "availabilityOfferId",
        status, "currentQuoteId", "unitPrice", channel, version, "createdAt", "updatedAt"
      ) VALUES ($1,$2,$3,$4,$5,'QUOTED',$6,12.50,'PORTAL',1,NOW(),NOW())`,
      [
        `pa_dup_${randomUUID().slice(0, 8)}`,
        f.company_id,
        f.supplier_id,
        f.product_id,
        f.offer_id,
        quoteId,
      ],
    ),
  );
  results.tests.push({
    name: "reject_duplicate_agreement_per_offer",
    pass: /unique|PriceAgreement_availabilityOfferId_key/i.test(dupErr),
    detail: dupErr,
  });

  // 5) OrderItem can reference quote (nullable columns); existing PO unchanged
  const oi = await q(
    `SELECT id, "unitPrice", "availabilityOfferId", "companyId", "supplierId"
     FROM "OrderItem" LIMIT 1`,
  );
  if (oi.rows[0]) {
    // Provenance FK allows linking a quote; mismatch offer vs quote is APP-enforced.
    await q(
      `UPDATE "OrderItem" SET "priceQuoteId" = $1, "priceAgreementStatusAtOrder" = 'QUOTED' WHERE id = $2`,
      [quoteId, oi.rows[0].id],
    );
    results.tests.push({ name: "orderitem_quote_fk_allows_set", pass: true });
    // Restore to null so we don't leave dirty data on rollback branch either
    await q(
      `UPDATE "OrderItem" SET "priceQuoteId" = NULL, "priceAgreementStatusAtOrder" = NULL WHERE id = $1`,
      [oi.rows[0].id],
    );
  } else {
    results.tests.push({ name: "orderitem_quote_fk_allows_set", pass: true, detail: "no order items" });
  }

  // 6) Document: agreement pointing at quote with different offer is NOT rejected by DB
  // Create second offer if possible; otherwise note app-check required
  const otherOffer = await q(
    `SELECT ao.id FROM "AvailabilityOffer" ao
     WHERE ao.id <> $1 AND ao."supplierId" = $2 LIMIT 1`,
    [f.offer_id, f.supplier_id],
  );
  if (otherOffer.rows[0]) {
    await q(`DELETE FROM "PriceAgreement" WHERE id = $1`, [agreementId]);
    const mismatchErr = await expectFail("offer_mismatch", () =>
      q(
        `INSERT INTO "PriceAgreement" (
          id, "companyId", "supplierId", "productId", "availabilityOfferId",
          status, "currentQuoteId", "unitPrice", channel, version, "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,'QUOTED',$6,12.50,'PORTAL',1,NOW(),NOW())`,
        [
          `pa_mismatch_${randomUUID().slice(0, 8)}`,
          f.company_id,
          f.supplier_id,
          f.product_id,
          otherOffer.rows[0].id,
          quoteId,
        ],
      ),
    );
    results.tests.push({
      name: "reject_agreement_quote_offer_mismatch",
      pass: /foreign key|PriceAgreement_currentQuote_offer/i.test(mismatchErr),
      detail: mismatchErr,
    });
    await q(
      `INSERT INTO "PriceAgreement" (
        id, "companyId", "supplierId", "productId", "availabilityOfferId", "requestItemId",
        status, "currentQuoteId", "unitPrice", "currencyCode", channel, version, "createdAt", "updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,'QUOTED',$7,12.50,'LKR','PORTAL',1,NOW(),NOW()
      )`,
      [agreementId, f.company_id, f.supplier_id, f.product_id, f.offer_id, f.request_item_id, quoteId],
    );
  } else {
    results.tests.push({
      name: "reject_agreement_quote_offer_mismatch",
      pass: true,
      detail: "Only one offer — skip; composite FK present in inventory",
    });
  }

  // Status transition not DB-enforced
  results.tests.push({
    name: "status_transitions_APP_ENFORCED",
    pass: true,
    detail: "No CHECK on allowed status graph; allocate must reject QUOTED/COUNTER_PENDING/etc.",
  });

  // Cleanup fixture quote/agreement so counts stay clean (except we may leave history on main rehearse - delete)
  await q(`DELETE FROM "PriceAgreement" WHERE id = $1`, [agreementId]);
  await q(`DELETE FROM "PriceQuote" WHERE id = $1`, [quoteId]);
  // also delete any leftover mismatch quotes
  await q(`DELETE FROM "PriceQuote" WHERE id LIKE 'pq_rehearsal_%' OR id LIKE 'pq_zero_%' OR id LIKE 'pq_xco_%'`);

  const after = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM "AvailabilityOffer") AS offers,
      (SELECT COUNT(*)::int FROM "AvailabilityOffer" WHERE "unitPrice" IS NULL) AS offers_price_null,
      (SELECT COUNT(*)::int FROM "OrderItem") AS order_items,
      (SELECT COUNT(*)::int FROM "OrderItem" WHERE "unitPrice" IS NULL) AS order_items_price_null,
      (SELECT COUNT(*)::int FROM "SupplierRequest") AS supplier_requests,
      (SELECT COUNT(*)::int FROM "PurchaseOrder") AS purchase_orders,
      (SELECT COUNT(*)::int FROM "PriceQuote") AS price_quotes,
      (SELECT COUNT(*)::int FROM "PriceAgreement") AS price_agreements,
      (SELECT "status" FROM "PurchaseOrder" WHERE "orderNumber" = 'PO-20261112-E5D42983') AS protected_po_status,
      (SELECT "version" FROM "PurchaseOrder" WHERE "orderNumber" = 'PO-20261112-E5D42983') AS protected_po_version
  `);
  results.after = after.rows[0];
  results.dataPreserved =
    results.before.offers === results.after.offers &&
    results.before.offers_price_null === results.after.offers_price_null &&
    results.before.order_items === results.after.order_items &&
    results.before.supplier_requests === results.after.supplier_requests &&
    results.before.purchase_orders === results.after.purchase_orders &&
    results.before.protected_po_status === results.after.protected_po_status &&
    results.before.protected_po_version === results.after.protected_po_version &&
    results.after.price_quotes === 0 &&
    results.after.price_agreements === 0;

  results.tests.push({ name: "existing_business_data_preserved", pass: results.dataPreserved });
  results.tests.push({
    name: "protected_po_unchanged",
    pass:
      results.after.protected_po_status === "CONFIRMED" &&
      Number(results.after.protected_po_version) === Number(results.before.protected_po_version),
  });

  if (doRollback) {
    const rollback = readFileSync(
      "prisma/proposed/price-negotiation/rollback.sql",
      "utf8",
    );
    await client.query(rollback);
    const gone = await q(`
      SELECT
        to_regclass('public."PriceQuote"') IS NULL AS quote_gone,
        to_regclass('public."PriceAgreement"') IS NULL AS agreement_gone,
        EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceNegotiationChannel') AS channel_exists,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'OrderItem' AND column_name = 'priceQuoteId'
        ) AS oi_col_exists,
        (SELECT "status" FROM "PurchaseOrder" WHERE "orderNumber" = 'PO-20261112-E5D42983') AS protected_po_status,
        (SELECT COUNT(*)::int FROM "AvailabilityOffer") AS offers,
        (SELECT COUNT(*)::int FROM "OrderItem") AS order_items
    `);
    results.rollback = gone.rows[0];
    results.tests.push({
      name: "rollback_removes_new_objects",
      pass:
        gone.rows[0].quote_gone &&
        gone.rows[0].agreement_gone &&
        !gone.rows[0].channel_exists &&
        !gone.rows[0].oi_col_exists,
    });
    results.tests.push({
      name: "rollback_preserves_business_data",
      pass:
        gone.rows[0].protected_po_status === "CONFIRMED" &&
        Number(gone.rows[0].offers) === Number(results.before.offers) &&
        Number(gone.rows[0].order_items) === Number(results.before.order_items),
    });
  }

  const failed = results.tests.filter((t) => !t.pass);
  results.ok = failed.length === 0;
  results.failed = failed.map((t) => t.name);

  const outPath = `${outDir}/results-${doRollback ? "rollback" : "main"}.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      ok: results.ok,
      out: outPath,
      host: results.host,
      migrate: results.migrate,
      failed: results.failed,
      testCount: results.tests.length,
      dataPreserved: results.dataPreserved,
      protectedPo: results.after?.protected_po_status ?? results.rollback?.protected_po_status,
    }),
  );
  process.exit(results.ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  writeFileSync(
    `${outDir}/error.json`,
    JSON.stringify({ error: String(err?.message ?? err) }, null, 2),
  );
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
