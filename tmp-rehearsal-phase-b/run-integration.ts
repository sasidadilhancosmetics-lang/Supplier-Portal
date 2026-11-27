/**
 * Runs the gated DB integration tests against the rehearsal branch only.
 * Env is forced to the rehearsal endpoint before vitest starts; the tests'
 * own dotenv(.env.local) call does not override variables already set.
 */
import { spawnSync } from "node:child_process";

import { REHEARSAL_ENDPOINT_ID, applyRehearsalEnv } from "./rehearsal-env";

const hosts = applyRehearsalEnv();
for (const h of [hosts.pooledHost, hosts.directHost]) {
  if (!h.startsWith(REHEARSAL_ENDPOINT_ID)) throw new Error(`Refusing: ${h}`);
}
console.log(`Integration target: ${hosts.pooledHost}`);

const r = spawnSync(
  "npx",
  ["vitest", "run", "src/lib/orders/allocate.concurrency.integration.test.ts", "src/lib/orders/cancel.concurrency.integration.test.ts"],
  { stdio: "inherit", shell: true, env: { ...process.env, RUN_DB_INTEGRATION: "1" } },
);
process.exitCode = r.status ?? 1;
