/**
 * Phase B rehearsal DB tool.
 *   identity                      endpoint identity of rehearsal (and dev, read-only)
 *   snapshot <label> <dev|rehearsal|pinned>  row hashes + catalog (READ ONLY txn)
 *                                 pinned: SNAPSHOT_URL must match SNAPSHOT_ENDPOINT
 *   compare <labelA> <labelB>     existing rows/catalog preserved; lists catalog additions
 *   verify-schema [dev|rehearsal] expected objects from migration.sql exist (READ ONLY txn)
 *   constraint-tests              rehearsal: behaviour tests inside a transaction, ROLLBACK
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseEnv } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import {
  DEVELOPMENT_ENDPOINT_ID,
  REHEARSAL_ENDPOINT_ID,
  applyRehearsalEnv,
} from "./rehearsal-env";

neonConfig.webSocketConstructor = ws;

const ROOT = process.cwd();
const OUT = path.join(ROOT, "tmp-rehearsal-phase-b", "out");
fs.mkdirSync(OUT, { recursive: true });

const NEW_TABLES = ["OsfImportLine", "OsfImportDistribution", "IntegrationCredential"];

function endpointOf(url: string) {
  return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
}

function devUrls() {
  const env = parseEnv(fs.readFileSync(path.join(ROOT, ".env.local")));
  const pooled = env.DATABASE_URL!;
  const direct = env.DATABASE_URL_UNPOOLED ?? env.DIRECT_DATABASE_URL!;
  for (const u of [pooled, direct]) {
    if (endpointOf(u) !== DEVELOPMENT_ENDPOINT_ID) throw new Error("dev URL is not the development endpoint");
  }
  return { pooled, direct };
}

function rehearsalUrls() {
  applyRehearsalEnv();
  return { pooled: process.env.DATABASE_URL!, direct: process.env.DATABASE_URL_UNPOOLED! };
}

async function withClient<T>(url: string, readOnly: boolean, fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>) {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    if (readOnly) await client.query("BEGIN READ ONLY");
    const q = async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    if (readOnly) await client.query("ROLLBACK");
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

const IDENTITY_SQL = `SELECT current_database()::text AS database,
  current_setting('server_version') AS server_version,
  current_setting('neon.endpoint_id', true) AS neon_endpoint_id,
  current_setting('neon.timeline_id', true) AS neon_timeline_id,
  current_setting('neon.tenant_id', true) AS neon_tenant_id,
  inet_server_addr()::text AS server_addr`;

async function identity() {
  const r = rehearsalUrls();
  const d = devUrls();
  const out: Record<string, unknown> = {};
  for (const [label, url, ro] of [
    ["rehearsal.pooled", r.pooled, true],
    ["rehearsal.direct", r.direct, true],
    ["development.direct (read-only)", d.direct, true],
  ] as const) {
    const [row] = await withClient(url, ro, (q) => q(IDENTITY_SQL));
    out[label] = { urlEndpoint: endpointOf(url), ...row };
  }
  const rp = out["rehearsal.pooled"] as any;
  const rd = out["rehearsal.direct"] as any;
  const dv = out["development.direct (read-only)"] as any;
  const checks = {
    rehearsalPooledEndpointMatches: rp.neon_endpoint_id ? rp.neon_endpoint_id === REHEARSAL_ENDPOINT_ID : "setting unavailable",
    rehearsalDirectEndpointMatches: rd.neon_endpoint_id ? rd.neon_endpoint_id === REHEARSAL_ENDPOINT_ID : "setting unavailable",
    rehearsalPooledAndDirectSameTimeline: rp.neon_timeline_id === rd.neon_timeline_id,
    rehearsalTimelineDiffersFromDevelopment: rd.neon_timeline_id !== dv.neon_timeline_id,
  };
  console.log(JSON.stringify({ ...out, checks }, null, 2));
  const ok = Object.values(checks).every((v) => v === true || v === "setting unavailable") && checks.rehearsalTimelineDiffersFromDevelopment;
  if (!ok) {
    process.exitCode = 1;
    console.error("IDENTITY CHECK FAILED");
  }
}

function pinnedUrl() {
  const url = process.env.SNAPSHOT_URL;
  const ep = process.env.SNAPSHOT_ENDPOINT;
  if (!url || !ep) throw new Error("pinned target needs SNAPSHOT_URL and SNAPSHOT_ENDPOINT");
  if (endpointOf(url) !== ep) throw new Error(`SNAPSHOT_URL endpoint ${endpointOf(url)} != ${ep}`);
  return url;
}

function targetUrl(target: string) {
  if (target === "dev") return devUrls().direct;
  if (target === "rehearsal") return rehearsalUrls().direct;
  if (target === "pinned") return pinnedUrl();
  throw new Error("target must be dev, rehearsal or pinned");
}

async function snapshot(label: string, target: string) {
  const url = targetUrl(target);
  const data = await withClient(url, true, async (q) => {
    const [id] = await q(IDENTITY_SQL);
    const tables = (await q(`SELECT table_name::text AS t FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1`)).map((r) => r.t as string);
    const rows: Record<string, string[]> = {};
    for (const t of tables) {
      const hs = await q(`SELECT md5(x::text) AS h FROM "${t}" x ORDER BY 1`);
      rows[t] = hs.map((r) => r.h);
    }
    const constraints = (await q(`SELECT c.conrelid::regclass::text AS tbl, c.conname::text AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1,2`));
    const indexes = await q(`SELECT tablename::text AS tbl, indexname::text AS name, indexdef AS def FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`);
    const enums = await q(`SELECT t.typname::text AS type, e.enumlabel::text AS value, e.enumsortorder::float AS sort
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY 1,3`);
    const columns = await q(`SELECT table_name::text AS tbl, column_name::text AS col, data_type::text AS type, is_nullable::text AS nullable, column_default::text AS dflt
      FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2`);
    const migrations = await q(`SELECT migration_name::text AS name, checksum::text AS checksum, finished_at, rolled_back_at, applied_steps_count, logs
      FROM "_prisma_migrations" ORDER BY started_at`);
    const protectedPo = await q(`SELECT id, "orderNumber", status::text AS status, "updatedAt", md5(po::text) AS row_hash FROM "PurchaseOrder" po WHERE "orderNumber"='PO-20261112-E5D42983'`);
    return { identity: id, rows, constraints, indexes, enums, columns, migrations, protectedPo };
  });
  const file = path.join(OUT, `snapshot-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  const counts = Object.fromEntries(Object.entries(data.rows).map(([t, r]) => [t, r.length]));
  console.log(JSON.stringify({ label, target, endpoint: data.identity.neon_endpoint_id, timeline: data.identity.neon_timeline_id, migrations: data.migrations.map((m: any) => m.name), protectedPo: data.protectedPo, rowCounts: counts }, null, 2));
}

function compare(a: string, b: string) {
  const A = JSON.parse(fs.readFileSync(path.join(OUT, `snapshot-${a}.json`), "utf8"));
  const B = JSON.parse(fs.readFileSync(path.join(OUT, `snapshot-${b}.json`), "utf8"));
  const rowProblems: string[] = [];
  const rowAdds: Record<string, number> = {};
  for (const [t, hs] of Object.entries<string[]>(A.rows)) {
    const after = B.rows[t];
    if (!after) { rowProblems.push(`${t}: table missing`); continue; }
    const counts = new Map<string, number>();
    for (const h of after) counts.set(h, (counts.get(h) ?? 0) + 1);
    let missing = 0;
    for (const h of hs) {
      const n = counts.get(h) ?? 0;
      if (n === 0) missing++; else counts.set(h, n - 1);
    }
    if (missing) rowProblems.push(`${t}: ${missing} existing row(s) changed or removed`);
    if (after.length - hs.length + missing) rowAdds[t] = after.length - hs.length + missing;
  }
  const key = (x: any) => `${x.tbl}|${x.name}|${x.def}`;
  const diffSet = (xa: any[], xb: any[], k: (x: any) => string) => {
    const sb = new Set(xb.map(k));
    const sa = new Set(xa.map(k));
    return { removedOrChanged: xa.filter((x) => !sb.has(k(x))).map(k), added: xb.filter((x) => !sa.has(k(x))).map(k) };
  };
  const colKey = (x: any) => `${x.tbl}.${x.col} ${x.type} null=${x.nullable} default=${x.dflt}`;
  const enumKey = (x: any) => `${x.type}.${x.value}`;
  const result = {
    compare: `${a} -> ${b}`,
    existingRowsPreserved: rowProblems.length === 0,
    rowProblems,
    rowsAdded: rowAdds,
    constraints: diffSet(A.constraints, B.constraints, key),
    indexes: diffSet(A.indexes, B.indexes, key),
    columns: diffSet(A.columns, B.columns, colKey),
    enums: diffSet(A.enums, B.enums, enumKey),
    migrationsAdded: B.migrations.map((m: any) => m.name).filter((n: string) => !A.migrations.some((m: any) => m.name === n)),
    protectedPoBefore: A.protectedPo,
    protectedPoAfter: B.protectedPo,
  };
  fs.writeFileSync(path.join(OUT, `compare-${a}-vs-${b}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ...result,
    constraints: { removedOrChanged: result.constraints.removedOrChanged, addedCount: result.constraints.added.length },
    indexes: { removedOrChanged: result.indexes.removedOrChanged, addedCount: result.indexes.added.length },
    columns: { removedOrChanged: result.columns.removedOrChanged, addedCount: result.columns.added.length },
    enums: result.enums,
  }, null, 2));
}

function expectedFromMigration() {
  const sql = fs.readFileSync(path.join(ROOT, "prisma/proposed/phase-b/migration.sql"), "utf8");
  const all = (re: RegExp) => [...sql.matchAll(re)].map((m) => m[1]);
  return {
    types: all(/CREATE TYPE "(\w+)"/g),
    addedEnumValues: all(/ALTER TYPE "OsfImportStatus" ADD VALUE '(\w+)'/g),
    tables: all(/CREATE TABLE "(\w+)"/g),
    osfImportColumns: all(/ADD COLUMN\s+"(\w+)"/g),
    indexes: all(/CREATE (?:UNIQUE )?INDEX "(\w+)"/g),
    foreignKeys: all(/ADD CONSTRAINT "(\w+)" FOREIGN KEY/g),
    checks: all(/ADD CONSTRAINT "(\w+)" CHECK/g),
  };
}

async function verifySchema(target = "rehearsal") {
  const exp = expectedFromMigration();
  const direct = targetUrl(target);
  const res = await withClient(direct, true, async (q) => {
    const types = (await q(`SELECT typname::text AS n FROM pg_type WHERE typname = ANY($1)`, [exp.types])).map((r) => r.n);
    const enumVals = await q(`SELECT t.typname::text AS type, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS vals
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN ('OsfImportStatus','OsfImportLineMappingStatus','OsfImportDistributionStatus') GROUP BY 1`);
    const tables = (await q(`SELECT table_name::text AS n FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [exp.tables])).map((r) => r.n);
    const cols = (await q(`SELECT column_name::text AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='OsfImport' AND column_name = ANY($1)`, [exp.osfImportColumns])).map((r) => r.n);
    const idx = (await q(`SELECT indexname::text AS n FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1)`, [exp.indexes])).map((r) => r.n);
    const fks = await q(`SELECT conname::text AS n, convalidated AS v, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='f' AND conname = ANY($1)`, [exp.foreignKeys]);
    const checks = await q(`SELECT conname::text AS n, convalidated AS v, conrelid::regclass::text AS tbl FROM pg_constraint WHERE contype='c' AND conname = ANY($1)`, [exp.checks]);
    const partialIdx = await q(`SELECT indexname::text AS n, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='SupplierRequest' AND indexdef ILIKE '% WHERE %'`);
    const migrations = await q(`SELECT migration_name::text AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count, logs FROM "_prisma_migrations" ORDER BY started_at`);
    const newTableRows = await q(`SELECT 'OsfImport' t, COUNT(*)::int c FROM "OsfImport" UNION ALL SELECT 'OsfImportLine', COUNT(*) FROM "OsfImportLine" UNION ALL SELECT 'OsfImportDistribution', COUNT(*) FROM "OsfImportDistribution" UNION ALL SELECT 'IntegrationCredential', COUNT(*) FROM "IntegrationCredential"`);
    return { types, enumVals, tables, cols, idx, fks, checks, partialIdx, migrations, newTableRows };
  });
  const missing = (want: string[], got: string[]) => want.filter((w) => !got.includes(w));
  const enumMap = Object.fromEntries(res.enumVals.map((r: any) => [r.type, r.vals]));
  const summary = {
    types: { expected: exp.types.length, missing: missing(exp.types, res.types) },
    enums: enumMap,
    tables: { expected: exp.tables.length, missing: missing(exp.tables, res.tables) },
    osfImportColumns: { expected: exp.osfImportColumns.length, missing: missing(exp.osfImportColumns, res.cols) },
    indexes: { expected: exp.indexes.length, missing: missing(exp.indexes, res.idx) },
    foreignKeys: { expected: exp.foreignKeys.length, missing: missing(exp.foreignKeys, res.fks.map((r: any) => r.n)), notValidated: res.fks.filter((r: any) => !r.v).map((r: any) => r.n), definitions: res.fks.map((r: any) => `${r.n}: ${r.def}`) },
    checks: { expected: exp.checks.length, missing: missing(exp.checks, res.checks.map((r: any) => r.n)), notValidated: res.checks.filter((r: any) => !r.v).map((r: any) => r.n) },
    supplierRequestPartialIndexes: res.partialIdx,
    migrations: res.migrations,
    newTableRowCounts: res.newTableRows,
  };
  const ok =
    summary.types.missing.length === 0 &&
    summary.tables.missing.length === 0 &&
    summary.osfImportColumns.missing.length === 0 &&
    summary.indexes.missing.length === 0 &&
    summary.foreignKeys.missing.length === 0 && summary.foreignKeys.notValidated.length === 0 &&
    summary.checks.missing.length === 0 && summary.checks.notValidated.length === 0 &&
    res.partialIdx.length === 0 &&
    JSON.stringify(enumMap.OsfImportStatus) === JSON.stringify(["RECEIVED", "PROCESSED", "FAILED", "NEEDS_REVIEW", "READY_TO_CONFIRM", "CONFIRMED"]);
  console.log(JSON.stringify({ ok, ...summary }, null, 2));
  if (!ok) process.exitCode = 1;
}

type Case = { name: string; sql: string; params?: unknown[]; expect: "ok" | string };

async function constraintTests() {
  const { direct } = rehearsalUrls();
  const pool = new Pool({ connectionString: direct });
  const client = await pool.connect();
  const results: { name: string; expect: string; outcome: string; pass: boolean }[] = [];
  try {
    const [idrow] = (await client.query(IDENTITY_SQL)).rows;
    if (idrow.neon_endpoint_id && idrow.neon_endpoint_id !== REHEARSAL_ENDPOINT_ID) throw new Error("not rehearsal endpoint");
    await client.query("BEGIN");
    const one = async (sql: string, p?: unknown[]) => (await client.query(sql, p)).rows[0];
    const prod = await one(`SELECT p.id AS "productId", p."brandId", p."companyId" FROM "Product" p ORDER BY p."createdAt" LIMIT 1`);
    const user = await one(`SELECT id FROM "User" WHERE "companyId" = $1 ORDER BY "createdAt" LIMIT 1`, [prod.companyId]);
    if (!prod || !user) throw new Error("no fixture product/user");
    const c = prod.companyId, b = prod.brandId, p = prod.productId, u = user.id;
    const now = "now()";
    const setup = [
      `INSERT INTO "Company"(id, name, "updatedAt") VALUES ('rh_c2', 'Rehearsal other co', ${now})`,
      `INSERT INTO "OsfImport"(id, "companyId", "idempotencyKey", "payloadHash", payload, "updatedAt") VALUES ('rh_imp1', '${c}', 'rh-key-1', 'hash1', '{}', ${now})`,
      `INSERT INTO "Requirement"(id, "companyId", "osfImportId", "brandId", "updatedAt") VALUES ('rh_r1', '${c}', 'rh_imp1', '${b}', ${now})`,
      `INSERT INTO "RequirementItem"(id, "requirementId", "productId", "quantityPlanned", "updatedAt") VALUES ('rh_ri1', 'rh_r1', '${p}', 5, ${now})`,
    ];
    for (const s of setup) await client.query(s);

    const lineCols = `(id, "companyId", "osfImportId", "sourceIndex", "lineKey", sku, "descriptionSnapshot", "brandNameSnapshot", "quantityProposed", "quantityPlanned", "mappingStatus", "brandId", "productId", "requirementId", "requirementItemId", "updatedAt")`;
    const line = (id: string, idx: number, key: string, status: string, prodId: string | null, brandId: string | null, qp: number, qplan: number, reqId: string | null, itemId: string | null, company = c) =>
      `INSERT INTO "OsfImportLine"${lineCols} VALUES ('${id}', '${company}', 'rh_imp1', ${idx}, '${key}', 'SKU', 'Desc', 'Brand', ${qp}, ${qplan}, '${status}', ${brandId ? `'${brandId}'` : "NULL"}, ${prodId ? `'${prodId}'` : "NULL"}, ${reqId ? `'${reqId}'` : "NULL"}, ${itemId ? `'${itemId}'` : "NULL"}, ${now})`;
    const dist = (id: string, status: string, extra: string, extraVals: string, req = "rh_r1", company = c) =>
      `INSERT INTO "OsfImportDistribution"(id, "companyId", "osfImportId", "requirementId", status, "updatedAt"${extra}) VALUES ('${id}', '${company}', 'rh_imp1', '${req}', '${status}', ${now}${extraVals})`;
    const claim = `, "claimToken", "claimedAt", "claimExpiresAt", "claimedById"`;
    const claimVals = `, 'tok', now(), now() + interval '5 minutes', '${u}'`;

    const cases: Case[] = [
      { name: "OsfImport: new status value NEEDS_REVIEW usable after commit", sql: `UPDATE "OsfImport" SET status='NEEDS_REVIEW' WHERE id='rh_imp1'`, expect: "ok" },
      { name: "OsfImport: CONFIRMED without confirmedAt/By rejected", sql: `UPDATE "OsfImport" SET status='CONFIRMED' WHERE id='rh_imp1'`, expect: "OsfImport_confirmed_fields_chk" },
      { name: "OsfImport: CONFIRMED with confirmedAt/By accepted", sql: `UPDATE "OsfImport" SET status='CONFIRMED', "confirmedAt"=now(), "confirmedById"='${u}' WHERE id='rh_imp1'`, expect: "ok" },
      { name: "OsfImport: version 0 rejected", sql: `UPDATE "OsfImport" SET version=0 WHERE id='rh_imp1'`, expect: "OsfImport_version_positive_chk" },
      { name: "OsfImport: payloadHash NOT NULL enforced", sql: `INSERT INTO "OsfImport"(id, "companyId", "idempotencyKey", payload, "updatedAt") VALUES ('rh_imp_x', '${c}', 'rh-key-x', '{}', now())`, expect: "23502" },
      { name: "Requirement: second requirement for same (import, brand) rejected", sql: `INSERT INTO "Requirement"(id, "companyId", "osfImportId", "brandId", "updatedAt") VALUES ('rh_r_dup', '${c}', 'rh_imp1', '${b}', now())`, expect: "Requirement_osfImportId_brandId_key" },
      { name: "Requirement: manual (NULL import) same brand twice accepted", sql: `INSERT INTO "Requirement"(id, "companyId", "brandId", "updatedAt") VALUES ('rh_m1', '${c}', '${b}', now()), ('rh_m2', '${c}', '${b}', now())`, expect: "ok" },
      { name: "Line: valid MATCHED_SKU linked to item accepted", sql: line("rh_l1", 0, "k1", "MATCHED_SKU", p, b, 5, 5, "rh_r1", "rh_ri1"), expect: "ok" },
      { name: "Line: duplicate lineKey in import rejected", sql: line("rh_l_dupk", 9, "k1", "UNKNOWN_SKU", null, null, 1, 1, null, null), expect: "OsfImportLine_osfImportId_lineKey_key" },
      { name: "Line: duplicate sourceIndex in import rejected", sql: line("rh_l_dupi", 0, "k9", "UNKNOWN_SKU", null, null, 1, 1, null, null), expect: "OsfImportLine_osfImportId_sourceIndex_key" },
      { name: "Line: same requirementItem linked twice rejected", sql: line("rh_l_dupitem", 8, "k8", "MATCHED_SKU", p, b, 5, 5, "rh_r1", "rh_ri1"), expect: "OsfImportLine_requirementItemId_key" },
      { name: "Line: MATCHED_SKU without product rejected", sql: line("rh_l2", 1, "k2", "MATCHED_SKU", null, b, 5, 5, null, null), expect: "OsfImportLine_matched_requires_product_chk" },
      { name: "Line: UNKNOWN_SKU without product accepted (never dropped)", sql: line("rh_l3", 2, "k3", "UNKNOWN_SKU", null, null, 5, 5, null, null), expect: "ok" },
      { name: "Line: negative quantityProposed rejected", sql: line("rh_l4", 3, "k4", "REJECTED_INVALID_QTY", null, null, -1, 0, null, null), expect: "OsfImportLine_quantityProposed_nonneg_chk" },
      { name: "Line: REJECTED_ZERO_QTY with zero quantities accepted", sql: line("rh_l5", 4, "k5", "REJECTED_ZERO_QTY", null, null, 0, 0, null, null), expect: "ok" },
      { name: "Line: linked item with quantityPlanned 0 rejected", sql: `UPDATE "OsfImportLine" SET "quantityPlanned"=0 WHERE id='rh_l1'`, expect: "OsfImportLine_item_link_chk" },
      { name: "Line: exclude = clear link then set 0 accepted", sql: `UPDATE "OsfImportLine" SET "requirementItemId"=NULL, "requirementId"=NULL, "mappingStatus"='EXCLUDED', "quantityPlanned"=0 WHERE id='rh_l1'`, expect: "ok" },
      { name: "Line: companyId not matching import company rejected (composite FK)", sql: line("rh_l6", 6, "k6", "UNKNOWN_SKU", null, null, 1, 1, null, null, "rh_c2"), expect: "OsfImportLine_osfImportId_companyId_fkey" },
      { name: "Distribution: IN_PROGRESS without claim rejected", sql: dist("rh_d0", "IN_PROGRESS", "", ""), expect: "OsfImportDistribution_in_progress_claim_chk" },
      { name: "Distribution: IN_PROGRESS with claim accepted", sql: dist("rh_d1", "IN_PROGRESS", claim, claimVals), expect: "ok" },
      { name: "Distribution: second ledger row for same (import, requirement) rejected", sql: dist("rh_d_dup", "IN_PROGRESS", claim, claimVals), expect: "OsfImportDistribution_osfImportId_requirementId_key" },
      { name: "Distribution: requirement of another company rejected (composite FK)", sql: dist("rh_d_x", "IN_PROGRESS", claim, claimVals, "rh_m1", "rh_c2"), expect: "OsfImportDistribution_osfImportId_companyId_fkey|OsfImportDistribution_requirementId_companyId_fkey" },
      { name: "Distribution: SUCCEEDED keeping claimToken rejected", sql: `UPDATE "OsfImportDistribution" SET status='SUCCEEDED', "completedAt"=now(), "supplierRequestIds"='["sr1"]' WHERE id='rh_d1'`, expect: "OsfImportDistribution_terminal_no_claim_chk" },
      { name: "Distribution: SUCCEEDED with empty supplierRequestIds rejected", sql: `UPDATE "OsfImportDistribution" SET status='SUCCEEDED', "claimToken"=NULL, "completedAt"=now(), "supplierRequestIds"='[]' WHERE id='rh_d1'`, expect: "OsfImportDistribution_succeeded_fields_chk" },
      { name: "Distribution: SUCCEEDED with non-array supplierRequestIds rejected (no runtime error)", sql: `UPDATE "OsfImportDistribution" SET status='SUCCEEDED', "claimToken"=NULL, "completedAt"=now(), "supplierRequestIds"='{"a":1}' WHERE id='rh_d1'`, expect: "OsfImportDistribution_succeeded_fields_chk" },
      { name: "Distribution: IN_PROGRESS -> FAILED without lastError rejected", sql: `UPDATE "OsfImportDistribution" SET status='FAILED', "claimToken"=NULL WHERE id='rh_d1'`, expect: "OsfImportDistribution_failed_fields_chk" },
      { name: "Distribution: IN_PROGRESS -> FAILED with lastError accepted", sql: `UPDATE "OsfImportDistribution" SET status='FAILED', "claimToken"=NULL, "lastError"='boom', "attemptCount"=1 WHERE id='rh_d1'`, expect: "ok" },
      { name: "Distribution: FAILED -> IN_PROGRESS reclaim accepted", sql: `UPDATE "OsfImportDistribution" SET status='IN_PROGRESS', "claimToken"='tok2', "claimedAt"=now(), "claimExpiresAt"=now()+interval '5 minutes', "attemptCount"=2 WHERE id='rh_d1'`, expect: "ok" },
      { name: "Distribution: SKIPPED with empty alreadyRequestedSupplierIds rejected", sql: `UPDATE "OsfImportDistribution" SET status='SKIPPED_ALREADY_REQUESTED', "claimToken"=NULL, "completedAt"=now(), "alreadyRequestedSupplierIds"='[]' WHERE id='rh_d1'`, expect: "OsfImportDistribution_skipped_fields_chk" },
      { name: "Distribution: SKIPPED with created request ids rejected", sql: `UPDATE "OsfImportDistribution" SET status='SKIPPED_ALREADY_REQUESTED', "claimToken"=NULL, "completedAt"=now(), "alreadyRequestedSupplierIds"='["s1"]', "supplierRequestIds"='["sr1"]' WHERE id='rh_d1'`, expect: "OsfImportDistribution_skipped_fields_chk" },
      { name: "Distribution: IN_PROGRESS -> SKIPPED_ALREADY_REQUESTED accepted", sql: `UPDATE "OsfImportDistribution" SET status='SKIPPED_ALREADY_REQUESTED', "claimToken"=NULL, "completedAt"=now(), "alreadyRequestedSupplierIds"='["s1"]', "supplierRequestIds"='[]' WHERE id='rh_d1'`, expect: "ok" },
      { name: "Distribution: SKIPPED -> IN_PROGRESS (future additional request) accepted", sql: `UPDATE "OsfImportDistribution" SET status='IN_PROGRESS', "claimToken"='tok3', "claimedAt"=now(), "claimExpiresAt"=now()+interval '5 minutes' WHERE id='rh_d1'`, expect: "ok" },
      { name: "Distribution: IN_PROGRESS -> SUCCEEDED (mixed: new + already requested) accepted", sql: `UPDATE "OsfImportDistribution" SET status='SUCCEEDED', "claimToken"=NULL, "completedAt"=now(), "supplierRequestIds"='["sr1"]', "alreadyRequestedSupplierIds"='["s1"]' WHERE id='rh_d1'`, expect: "ok" },
      { name: "Distribution: negative attemptCount rejected", sql: `UPDATE "OsfImportDistribution" SET "attemptCount"=-1 WHERE id='rh_d1'`, expect: "OsfImportDistribution_attemptCount_nonneg_chk" },
      { name: "Credential: active with revokedAt rejected", sql: `INSERT INTO "IntegrationCredential"(id, "companyId", "cosmoCompanyId", name, "tokenHash", "tokenPrefix", "revokedAt", "updatedAt") VALUES ('rh_k0', '${c}', 'cosmo-1', 'k', 'h0', 'p0', now(), now())`, expect: "IntegrationCredential_revoked_inactive_chk" },
      { name: "Credential: two active credentials for same binding accepted (rotation)", sql: `INSERT INTO "IntegrationCredential"(id, "companyId", "cosmoCompanyId", name, "tokenHash", "tokenPrefix", "updatedAt") VALUES ('rh_k1', '${c}', 'cosmo-1', 'k1', 'h1', 'p1', now()), ('rh_k2', '${c}', 'cosmo-1', 'k2', 'h2', 'p2', now())`, expect: "ok" },
      { name: "Credential: duplicate tokenHash rejected", sql: `INSERT INTO "IntegrationCredential"(id, "companyId", "cosmoCompanyId", name, "tokenHash", "tokenPrefix", "updatedAt") VALUES ('rh_k3', '${c}', 'cosmo-1', 'k3', 'h1', 'p3', now())`, expect: "IntegrationCredential_tokenHash_key" },
      { name: "Credential: revoke (revokedAt + isActive=false) accepted", sql: `UPDATE "IntegrationCredential" SET "revokedAt"=now(), "isActive"=false, "revokedById"='${u}' WHERE id='rh_k1'`, expect: "ok" },
      { name: "SupplierRequest: no DB uniqueness blocks additional request to same supplier", sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='SupplierRequest' AND indexdef ILIKE '%UNIQUE%("requirementId"%')`, expect: "ok" },
    ];

    let sp = 0;
    for (const tc of cases) {
      const name = `sp${sp++}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const r = await client.query(tc.sql);
        if (tc.sql.startsWith("UPDATE") && r.rowCount === 0) throw Object.assign(new Error("no rows updated"), { code: "NOROWS" });
        if (tc.sql.startsWith("SELECT") && r.rowCount === 0) throw Object.assign(new Error("assertion query returned no row"), { code: "ASSERT" });
        await client.query(`RELEASE SAVEPOINT ${name}`);
        results.push({ name: tc.name, expect: tc.expect, outcome: "ok", pass: tc.expect === "ok" });
      } catch (e: any) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        const tag = e.constraint ?? e.code ?? e.message;
        const pass = tc.expect !== "ok" && (tc.expect.split("|").includes(tag) || tc.expect === e.code);
        results.push({ name: tc.name, expect: tc.expect, outcome: `rejected: ${tag} (${e.code})`, pass });
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
  const verifyPool = new Pool({ connectionString: direct });
  const leftovers = (await verifyPool.query(`SELECT
    (SELECT COUNT(*) FROM "OsfImport")::int AS osf_import,
    (SELECT COUNT(*) FROM "OsfImportLine")::int AS lines,
    (SELECT COUNT(*) FROM "OsfImportDistribution")::int AS dists,
    (SELECT COUNT(*) FROM "IntegrationCredential")::int AS creds,
    (SELECT COUNT(*) FROM "Company" WHERE id LIKE 'rh_%')::int AS rh_companies,
    (SELECT COUNT(*) FROM "Requirement" WHERE id LIKE 'rh_%')::int AS rh_requirements`)).rows[0];
  await verifyPool.end();
  await pool.end();
  const passed = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(OUT, "constraint-tests.json"), JSON.stringify({ results, leftovers }, null, 2));
  console.log(JSON.stringify({ passed, total: results.length, failures: results.filter((r) => !r.pass), leftoversAfterRollback: leftovers }, null, 2));
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  -> ${r.outcome}`);
  if (passed !== results.length) process.exitCode = 1;
}

const [cmd, a, b] = process.argv.slice(2);
const run = async () => {
  if (cmd === "identity") return identity();
  if (cmd === "snapshot") return snapshot(a, b);
  if (cmd === "compare") return compare(a, b);
  if (cmd === "verify-schema") return verifySchema(a);
  if (cmd === "constraint-tests") return constraintTests();
  throw new Error("unknown command");
};
run().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
