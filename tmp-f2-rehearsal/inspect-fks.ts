import { config } from "dotenv";
import pg from "pg";

config({ path: "tmp-f2-rehearsal/.env.main", override: true });

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DIRECT_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const fks = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = '"OsfRequestSuggestion"'::regclass AND contype = 'f'
    ORDER BY 1
  `);
  const chks = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = '"OsfRequestSuggestion"'::regclass AND contype = 'c'
    ORDER BY 1
  `);
  const idxs = await client.query(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE indexname IN (
      'OsfImportLine_id_companyId_key',
      'OsfImportLine_id_osfImportId_companyId_key',
      'OsfImportLine_id_osfImportId_companyId_lineKey_key',
      'Supplier_companyId_externalId_key',
      'OsfRequestSuggestion_osfImportId_osfImportLineId_cosmoSupplierId_key'
    )
    OR tablename = 'OsfRequestSuggestion'
    ORDER BY 1, 2
  `);
  const suggestionCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM "OsfRequestSuggestion"`,
  );
  console.log(
    JSON.stringify(
      {
        fks: fks.rows,
        chks: chks.rows,
        idxs: idxs.rows,
        suggestionRows: suggestionCount.rows[0],
      },
      null,
      2,
    ),
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
