import "server-only";

import { connection } from "next/server";

import { auth0 } from "@/lib/auth0";

/**
 * Request-bound Auth0 session read.
 * Auth0 expiry checks use wall-clock time; with Cache Components that must not
 * run in the static shell. Prefer this over auth0.getSession() in RSC/actions.
 */
export async function getAuth0Session() {
  await connection();
  return auth0.getSession();
}
