/** Fixed codes only: never pass SDK errors, request data or identity values. */
export type AuthDiagnostic =
  | "session_cookie_missing"
  | "session_missing"
  | "session_subject_missing"
  | "session_read_failed"
  | "application_issuer_missing"
  | "application_user_missing_or_inactive"
  | "application_user_lookup_failed"
  | "authorization_denied";

export function reportAuthDiagnostic(event: AuthDiagnostic): void {
  if (typeof window === "undefined") console.warn(`[auth] ${event}`);
}
