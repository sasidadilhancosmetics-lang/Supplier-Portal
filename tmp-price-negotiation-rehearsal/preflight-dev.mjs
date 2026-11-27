import { neon } from "@neondatabase/serverless";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
};
const pooled = get("DATABASE_URL");
const unpooled = get("DATABASE_URL_UNPOOLED") || get("DIRECT_DATABASE_URL");

function host(u) {
  try {
    return new URL(u.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    return "bad";
  }
}

const hp = host(pooled);
const hu = host(unpooled);
const summary = {
  pooledHost: hp,
  unpooledHost: hu,
  isDevPooled: hp.includes("little-credit-b35km102"),
  isDevUnpooled: hu.includes("little-credit-b35km102") && !hu.includes("pooler"),
  isProd: hp.includes("fancy-voice") || hu.includes("fancy-voice"),
};
console.log(JSON.stringify(summary, null, 2));

if (summary.isProd) {
  console.error("ABORT production");
  process.exit(2);
}
if (!summary.isDevUnpooled) {
  console.error("ABORT bad unpooled");
  process.exit(3);
}

const sql = neon(unpooled);
const id = await sql`select current_database() as db, inet_server_addr()::text as addr`;
const mig = await sql`select migration_name from _prisma_migrations order by finished_at`;
const counts = await sql`
  select
    (select count(*)::int from "AvailabilityOffer") as offers,
    (select count(*)::int from "OrderItem") as order_items,
    (select count(*)::int from "PurchaseOrder") as purchase_orders
`;
const po = await sql`
  select status, version, "orderNumber"
  from "PurchaseOrder"
  where "orderNumber" = 'PO-20261112-E5D42983'
`;
const exists = await sql`
  select to_regclass('"PriceQuote"') as pq, to_regclass('"PriceAgreement"') as pa
`;

console.log(
  JSON.stringify(
    {
      identity: id[0],
      migrations: mig.map((r) => r.migration_name),
      counts: counts[0],
      protectedPo: po[0] || null,
      alreadyHasTables: exists[0],
    },
    null,
    2,
  ),
);
