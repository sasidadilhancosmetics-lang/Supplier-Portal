// Offline verification of the Phase B review migration. No database access.
// 1. The GENERATED section of migration.sql equals fresh `prisma migrate diff` output.
// 2. Everything outside that section is on the documented custom allowlist.
// 3. No forbidden statements (CONCURRENTLY, DROP, TRUNCATE, DELETE, UPDATE, PurchaseOrder…).
// Usage: node prisma/proposed/phase-b/verify-migration-offline.mjs
import { readFileSync } from "node:fs";

const dir = "prisma/proposed/phase-b";
const migration = readFileSync(`${dir}/migration.sql`, "utf8");
const generated = readFileSync(`${dir}/generated-diff.sql`, "utf8");

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const begin = migration.indexOf("-- >>> GENERATED BEGIN");
const end = migration.indexOf("-- <<< GENERATED END");
if (begin < 0 || end < 0 || end < begin) throw new Error("GENERATED markers missing");

const genSection = migration.slice(migration.indexOf("\n", begin) + 1, end);
const a = statements(genSection);
const b = statements(generated);
const sameGenerated = a.length === b.length && a.every((s, i) => s === b[i]);

const customSql = migration.slice(0, begin) + migration.slice(end);
const custom = statements(customSql.replace(/DO \$\$[\s\S]*?END \$\$/g, "DO_PREFLIGHT"));
const allowed = [/^BEGIN$/, /^COMMIT$/, /^DO_PREFLIGHT$/, /^ALTER TABLE "\w+" ADD CONSTRAINT "\w+_chk" CHECK/];
const unexpectedCustom = custom.filter((s) => !allowed.some((re) => re.test(s)));

const forbidden = /\b(CONCURRENTLY|DROP|TRUNCATE|DELETE|UPDATE "|INSERT|VACUUM)\b|"PurchaseOrder"|"OrderItem"|"SupplierRequest"/i;
const forbiddenHits = statements(migration).filter((s) =>
  forbidden.test(s.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/gi, "")),
);

const checkNames = [...customSql.matchAll(/ADD CONSTRAINT "(\w+_chk)"/g)].map((m) => m[1]);

const result = {
  generatedStatementCount: b.length,
  generatedSectionMatchesPrismaDiff: sameGenerated,
  customStatementCount: custom.length,
  unexpectedCustomStatements: unexpectedCustom,
  forbiddenStatementHits: forbiddenHits,
  checkConstraints: checkNames,
  beginCount: (migration.match(/^BEGIN;/gm) ?? []).length,
  commitCount: (migration.match(/^COMMIT;/gm) ?? []).length,
};
result.ok =
  result.generatedSectionMatchesPrismaDiff &&
  result.unexpectedCustomStatements.length === 0 &&
  result.forbiddenStatementHits.length === 0 &&
  result.beginCount === 1 &&
  result.commitCount === 1;

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
