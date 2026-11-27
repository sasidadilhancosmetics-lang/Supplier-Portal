import "server-only";

import { redirect, unstable_rethrow } from "next/navigation";
import { isAuthorizationError } from "./errors";

/** Call before a page's generic/domain error fallback. */
export function rethrowPageAuthError(error: unknown): void {
  unstable_rethrow(error);
  if (!isAuthorizationError(error)) return;
  if (error.code === "UNAUTHENTICATED") redirect("/auth/login");
  throw error;
}

/** Wrap page reads only. Service/action guards retain their 401/403 contract. */
export async function loadProtectedPage<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    rethrowPageAuthError(error);
    // Authenticated permission denials, SDK failures and domain errors retain
    // their original type/status; none can become an anonymous login loop.
    throw error;
  }
}
