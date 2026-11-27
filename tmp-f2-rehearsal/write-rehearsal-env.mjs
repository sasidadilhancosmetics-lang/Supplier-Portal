/**
 * Writes local-only connection env for F2 rehearsal branches.
 * Expects neon CLI JSON on stdin from `neon connection-string` or branch create.
 */
import { writeFileSync } from "node:fs";

const raw = await new Promise((resolve, reject) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => resolve(data));
  process.stdin.on("error", reject);
});

const parsed = JSON.parse(raw);
const uri =
  parsed.connection_uris?.[0]?.connection_uri ??
  parsed.uri ??
  parsed.connectionUri;
if (!uri || typeof uri !== "string") {
  console.error("No connection URI in neon JSON");
  process.exit(1);
}
const branchId = parsed.branch?.id ?? process.env.REHEARSAL_BRANCH_ID;
const host = new URL(uri).hostname;
const pooled = uri.includes("-pooler")
  ? uri
  : uri.replace(
      host,
      host.replace(".c-", "-pooler.c-").replace(
        /^([^.]+\.)/,
        (m) => m.replace(/\.$/, "") + (host.includes("-pooler") ? "." : "-pooler."),
      ),
    );

// Prefer CLI-provided pooler host when present.
const poolerHost =
  parsed.connection_uris?.[0]?.connection_parameters?.pooler_host ?? null;
let pooledUri = uri;
if (poolerHost && !uri.includes("-pooler")) {
  pooledUri = uri.replace(host, poolerHost);
}

const name = process.argv[2] || "rehearsal";
const out = `tmp-f2-rehearsal/.env.${name}`;
writeFileSync(
  out,
  [
    `REHEARSAL_BRANCH_ID=${branchId ?? ""}`,
    `REHEARSAL_BRANCH_NAME=${parsed.branch?.name ?? name}`,
    `REHEARSAL_HOST=${host}`,
    `DATABASE_URL=${pooledUri}`,
    `DATABASE_URL_UNPOOLED=${uri}`,
    `DIRECT_DATABASE_URL=${uri}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    wrote: out,
    branchId: branchId ?? null,
    host,
    poolerHost,
  }),
);
