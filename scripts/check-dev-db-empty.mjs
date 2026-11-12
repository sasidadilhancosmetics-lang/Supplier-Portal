import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const branch = process.env.NEON_BRANCH;
const url = process.env.DATABASE_URL_UNPOOLED;

if (branch !== "development") {
  console.log(`STOP_BRANCH=${branch}`);
  process.exit(2);
}

if (!url) {
  console.log("STOP_NO_URL");
  process.exit(2);
}

const host = url.match(/@([^/?]+)/)?.[1] ?? "unknown";
if (host.includes("fancy-voice")) {
  console.log("STOP_PROD_HOST");
  process.exit(3);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const tables = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);

const enums = await client.query(`
  SELECT t.typname
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
  ORDER BY t.typname
`);

const prismaMig = await client.query(`
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
  ) AS exists
`);

console.log(`CONNECTED_HOST=${host}`);
console.log(`NEON_BRANCH=${branch}`);
console.log(`PUBLIC_TABLE_COUNT=${tables.rowCount}`);
console.log(
  `PUBLIC_TABLES=${tables.rows.map((r) => r.tablename).join(",") || "(none)"}`,
);
console.log(`PUBLIC_ENUM_COUNT=${enums.rowCount}`);
console.log(`PRISMA_MIGRATIONS_TABLE=${prismaMig.rows[0].exists}`);

await client.end();

if (tables.rowCount > 0 || prismaMig.rows[0].exists) {
  console.log("STOP_NOT_EMPTY");
  process.exit(4);
}

console.log("EMPTY_DEV_DB_CONFIRMED");
