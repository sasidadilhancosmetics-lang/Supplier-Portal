export type OsfImportDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_EDITABLE"
  | "VERSION_CONFLICT"
  | "INVALID_PRODUCT"
  | "INVALID_BRAND"
  | "INVALID_STATE"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "NOT_READY";

export class OsfImportDomainError extends Error {
  readonly code: OsfImportDomainCode;

  constructor(code: OsfImportDomainCode, message: string) {
    super(message);
    this.name = "OsfImportDomainError";
    this.code = code;
  }
}

export function isOsfImportDomainError(
  error: unknown,
): error is OsfImportDomainError {
  return error instanceof OsfImportDomainError;
}

export function osfImportErrorMessage(error: unknown): string {
  if (isOsfImportDomainError(error)) return error.message;
  return "Something went wrong. Please try again.";
}
