/**
 * Read-only: what changed on development during the rehearsal window.
 * READ ONLY transaction; prints no emails or secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseEnv } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { DEVELOPMENT_ENDPOINT_ID } from "./rehearsal-env";

neonConfig.webSocketConstructor = ws;

async function main() {
  const env = parseEnv(fs.readFileSync(path.join(process.cwd(), ".env.local")));
  const url = env.DATABASE_URL_UNPOOLED!;
  if (!new URL(url).hostname.startsWith(DEVELOPMENT_ENDPOINT_ID)) throw new Error("not development");
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const since = "2026-11-12T11:30:00Z";
    const q = async (sql: string) => (await c.query(sql, [since])).rows;
    const out = {
      since,
      users: await q(`SELECT id, role::text AS role, "companyId", "supplierId", "createdAt", "updatedAt", split_part(email, '@', 2) AS email_domain
        FROM "User" WHERE "createdAt" >= $1 OR "updatedAt" >= $1 ORDER BY "updatedAt"`),
      externalIdentities: await q(`SELECT id, "userId", provider, "createdAt", "updatedAt" FROM "ExternalIdentity" WHERE "createdAt" >= $1 OR "updatedAt" >= $1 ORDER BY "updatedAt"`),
      otherTablesTouched: await q(`SELECT 'AuditLog' t, COUNT(*)::int n FROM "AuditLog" WHERE "createdAt" >= $1
        UNION ALL SELECT 'Requirement', COUNT(*) FROM "Requirement" WHERE "updatedAt" >= $1
        UNION ALL SELECT 'SupplierRequest', COUNT(*) FROM "SupplierRequest" WHERE "updatedAt" >= $1
        UNION ALL SELECT 'PurchaseOrder', COUNT(*) FROM "PurchaseOrder" WHERE "updatedAt" >= $1
        UNION ALL SELECT 'Company', COUNT(*) FROM "Company" WHERE "updatedAt" >= $1`),
    };
    await c.query("ROLLBACK");
    console.log(JSON.stringify(out, null, 2));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
