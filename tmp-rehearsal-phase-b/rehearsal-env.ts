/**
 * Phase B rehearsal env guard. Loads ONLY tmp-rehearsal-phase-b/.env.rehearsal
 * (never .env.local), refuses any URL that is not the rehearsal endpoint, then
 * points every DB variable in this process at the rehearsal branch.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

export const REHEARSAL_BRANCH_ID = "br-hidden-cake-b3s3sjyz";
export const REHEARSAL_ENDPOINT_ID = "ep-muddy-bird-b3hsfby3";
export const DEVELOPMENT_ENDPOINT_ID = "ep-little-credit-b35km102";
export const DEVELOPMENT_BRANCH_ID = "br-morning-glade-b3odmb6e";
export const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";

function endpointOf(url: string): string {
  return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
}

export function applyRehearsalEnv() {
  const parsed = loadEnv({
    path: path.resolve(process.cwd(), "tmp-rehearsal-phase-b/.env.rehearsal"),
    processEnv: {},
  }).parsed;
  if (!parsed) throw new Error("Rehearsal env file missing.");

  const pooled = parsed.REHEARSAL_DATABASE_URL;
  const direct = parsed.REHEARSAL_DATABASE_URL_UNPOOLED;
  if (parsed.REHEARSAL_BRANCH_ID !== REHEARSAL_BRANCH_ID) {
    throw new Error("Rehearsal env: unexpected branch id.");
  }
  for (const [label, url] of [
    ["pooled", pooled],
    ["direct", direct],
  ] as const) {
    if (!url) throw new Error(`Rehearsal env: ${label} URL missing.`);
    const ep = endpointOf(url);
    if (ep !== REHEARSAL_ENDPOINT_ID) {
      throw new Error(`Rehearsal env: ${label} URL endpoint ${ep} is not the rehearsal endpoint.`);
    }
  }
  if (!new URL(pooled).hostname.includes("-pooler.")) {
    throw new Error("Rehearsal env: pooled URL is not a pooler host.");
  }

  process.env.DATABASE_URL = pooled;
  process.env.DATABASE_URL_UNPOOLED = direct;
  process.env.DIRECT_DATABASE_URL = direct;
  process.env.NEON_BRANCH_ID = REHEARSAL_BRANCH_ID;
  process.env.NEON_BRANCH = "rehearsal-phase-b-20261112";

  return {
    pooledHost: new URL(pooled).hostname,
    directHost: new URL(direct).hostname,
  };
}
