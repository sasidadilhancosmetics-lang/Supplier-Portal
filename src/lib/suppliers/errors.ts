export type SupplierDomainCode =
  | "VALIDATION"
  | "DUPLICATE_NAME"
  | "DUPLICATE_EXTERNAL_ID"
  | "EXTERNAL_ID_CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "NOT_FOUND"
  | "BRAND_LOCKED"
  | "ALL_BRANDS_LOCKED"
  | "INVALID_BRAND"
  | "FORBIDDEN"
  | "EMAIL_UNVERIFIED"
  | "IDENTITY_IN_USE"
  | "USER_CONFLICT"
  | "ALREADY_REGISTERED"
  | "INVALID_STATUS";

export class SupplierDomainError extends Error {
  readonly code: SupplierDomainCode;

  constructor(code: SupplierDomainCode, message: string) {
    super(message);
    this.name = "SupplierDomainError";
    this.code = code;
  }
}

export function isSupplierDomainError(
  error: unknown,
): error is SupplierDomainError {
  return error instanceof SupplierDomainError;
}

/** Safe client-facing message — never include other suppliers' data. */
export function supplierErrorMessage(error: unknown): string {
  if (isSupplierDomainError(error)) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
