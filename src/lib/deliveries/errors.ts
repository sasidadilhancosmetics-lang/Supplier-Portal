export type DeliveryDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATUS"
  | "OVER_DELIVERY"
  | "NOTHING_TO_DELIVER"
  | "DISCREPANCY_NOTES_REQUIRED"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "CONCURRENCY_CONFLICT";

export class DeliveryDomainError extends Error {
  readonly code: DeliveryDomainCode;
  readonly fieldErrors?: Record<string, string>;
  readonly retryable: boolean;

  constructor(
    code: DeliveryDomainCode,
    message: string,
    options?: { fieldErrors?: Record<string, string>; retryable?: boolean },
  ) {
    super(message);
    this.name = "DeliveryDomainError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.retryable = options?.retryable ?? code === "CONCURRENCY_CONFLICT";
  }
}

export function isDeliveryDomainError(
  error: unknown,
): error is DeliveryDomainError {
  return error instanceof DeliveryDomainError;
}
