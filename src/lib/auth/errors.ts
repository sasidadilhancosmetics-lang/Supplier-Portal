import { reportAuthDiagnostic } from "./diagnostics";

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

/**
 * Thrown by authorization helpers used from server actions and route handlers.
 * Page guards map these to redirects / notFound() without leaking details.
 */
export class AuthorizationError extends Error {
  readonly code: AuthErrorCode;
  readonly status: 401 | 403 | 404;

  constructor(code: AuthErrorCode, message = "Unauthorized") {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    if (code === "FORBIDDEN") reportAuthDiagnostic("authorization_denied");
    this.status =
      code === "UNAUTHENTICATED" ? 401 : code === "NOT_FOUND" ? 404 : 403;
  }
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
