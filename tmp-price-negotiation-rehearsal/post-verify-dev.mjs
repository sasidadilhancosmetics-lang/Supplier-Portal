import { neon } from "@neondatabase/serverless";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
};
const unpooled = get("DATABASE_URL_UNPOOLED") || get("DIRECT_DATABASE_URL");
const hu = new URL(unpooled.replace(/^postgresql:/, "http:")).hostname;
if (!hu.includes("little-credit-b35km102") || hu.includes("pooler") || hu.includes("fancy-voice")) {
  console.error("ABORT bad host", hu);
  process.exit(2);
}

const sql = neon(unpooled);
const mig = await sql`select migration_name, finished_at is not null as done from _prisma_migrations order by finished_at`;
const tables = await sql`
  select to_regclass('"PriceQuote"')::text as pq,
         to_regclass('"PriceAgreement"')::text as pa
`;
const enums = await sql`
  select t.typname
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname in ('PriceNegotiationChannel','PriceQuoteKind','PriceAgreementStatus')
  order by 1
`;
const checks = await sql`
  select conname from pg_constraint
  where conname in (
    'PriceQuote_unitPrice_positive',
    'PriceAgreement_unitPrice_positive',
    'PriceAgreement_availabilityOfferId_key'
  )
  order by 1
`;
const fks = await sql`
  select conname from pg_constraint
  where contype = 'f'
    and conrelid in ('"PriceQuote"'::regclass, '"PriceAgreement"'::regclass, '"OrderItem"'::regclass)
    and conname like '%price%' or conname like 'Price%'
  order by 1
`;
const idx = await sql`
  select indexname from pg_indexes
  where tablename in ('PriceQuote','PriceAgreement','OrderItem')
    and (indexname like '%Price%' or indexname like '%priceQuote%')
  order by 1
`;
const cols = await sql`
  select column_name from information_schema.columns
  where table_name = 'OrderItem'
    and column_name in ('priceQuoteId','priceAgreementStatusAtOrder','unitPrice')
  order by 1
`;
const counts = await sql`
  select
    (select count(*)::int from "AvailabilityOffer") as offers,
    (select count(*)::int from "AvailabilityOffer" where "unitPrice" is null) as offers_price_null,
    (select count(*)::int from "OrderItem") as order_items,
    (select count(*)::int from "OrderItem" where "unitPrice" is null) as order_items_price_null,
    (select count(*)::int from "PurchaseOrder") as purchase_orders,
    (select count(*)::int from "PriceQuote") as price_quotes,
    (select count(*)::int from "PriceAgreement") as price_agreements
`;
const po = await sql`
  select status, version, "orderNumber"
  from "PurchaseOrder"
  where "orderNumber" = 'PO-20261112-E5D42983'
`;

console.log(
  JSON.stringify(
    {
      host: hu,
      migrations: mig,
      tables: tables[0],
      enums: enums.map((e) => e.typname),
      checks: checks.map((c) => c.conname),
      fks: fks.map((f) => f.conname),
      indexes: idx.map((i) => i.indexname),
      orderItemCols: cols.map((c) => c.column_name),
      counts: counts[0],
      protectedPo: po[0] || null,
    },
    null,
    2,
  ),
);
