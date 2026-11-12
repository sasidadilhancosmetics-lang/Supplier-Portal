export type RequestDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_CONFIRMED"
  | "NO_RECIPIENTS"
  | "DUPLICATE_REQUEST"
  | "INACTIVE_SUPPLIER"
  | "INVALID_SUPPLIER"
  | "EMPTY_ITEMS"
  | "NOT_DRAFT_OFFER"
  | "STALE_VERSION"
  | "INVALID_STATUS";

export class RequestDomainError extends Error {
  readonly code: RequestDomainCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: RequestDomainCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "RequestDomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function isRequestDomainError(
  error: unknown,
): error is RequestDomainError {
  return error instanceof RequestDomainError;
}

export function requestErrorMessage(error: unknown): string {
  if (isRequestDomainError(error)) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
