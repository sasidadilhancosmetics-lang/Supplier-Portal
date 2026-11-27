import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", override: true });

async function main() {
  const branch = process.env.NEON_BRANCH_ID;
  if (branch !== "br-morning-glade-b3odmb6e") {
    throw new Error(`Unexpected parent env branch ${branch}`);
  }
  const sql = neon(process.env.DATABASE_URL!);
  const row = await sql`
    SELECT
      to_regclass('public."OsfRequestSuggestion"') IS NOT NULL AS table_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'OsfImportLine_id_companyId_key'
      ) AS f2_unique_exists
  `;
  const po = await sql`
    SELECT status::text AS status FROM "PurchaseOrder"
    WHERE "orderNumber" = 'PO-20261112-E5D42983'
  `;
  console.log(JSON.stringify({ branch, ...row[0], po: po[0] }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
