export type PricingErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATUS"
  | "STALE_VERSION"
  | "OFFER_QUOTE_MISMATCH"
  | "PRICE_NOT_AGREED";

export class PricingDomainError extends Error {
  readonly code: PricingErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: PricingErrorCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "PricingDomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function isPricingDomainError(
  error: unknown,
): error is PricingDomainError {
  return error instanceof PricingDomainError;
}

export function pricingErrorMessage(error: PricingDomainError): string {
  return error.message;
}
