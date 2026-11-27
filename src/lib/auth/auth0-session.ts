import "server-only";

import { connection } from "next/server";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { auth0 } from "@/lib/auth0";
import { reportAuthDiagnostic } from "./diagnostics";

export class AuthSessionReadError extends Error {
  constructor() {
    super("Authentication session could not be read.");
    this.name = "AuthSessionReadError";
  }
}

/**
 * Request-bound Auth0 session read.
 * Auth0 expiry checks use wall-clock time; with Cache Components that must not
 * run in the static shell. Prefer this over auth0.getSession() in RSC/actions.
 */
export async function getAuth0Session() {
  await connection();
  const cookieStore = await cookies();
  // SDK defaults, including chunked and legacy session cookies. Names/values
  // stay in memory; only the fixed outcome code is logged.
  const hasSessionCookie = cookieStore.getAll().some(({ name }) =>
    /^(?:__session(?:__\d+)?|appSession(?:\.\d+)?)$/.test(name),
  );
  let session;
  try {
    session = await auth0.getSession();
  } catch (error) {
    unstable_rethrow(error);
    reportAuthDiagnostic("session_read_failed");
    // Do not attach the original exception: SDK messages may contain secrets.
    throw new AuthSessionReadError();
  }
  if (!session) {
    reportAuthDiagnostic(hasSessionCookie ? "session_missing" : "session_cookie_missing");
  } else if (!session.user?.sub) {
    reportAuthDiagnostic("session_subject_missing");
  }
  return session;
}
