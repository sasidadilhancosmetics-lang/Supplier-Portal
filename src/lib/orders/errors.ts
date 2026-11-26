export type OrderDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "OFFER_NOT_ALLOCATABLE"
  | "INSUFFICIENT_OFFER"
  | "ABOVE_PLAN_REQUIRED"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "CONCURRENCY_CONFLICT"
  | "MISSING_REQUIREMENT_LINK"
  | "MIXED_SUPPLIER"
  | "INVALID_STATUS"
  | "DELIVERY_HOLD"
  | "NOTHING_TO_CANCEL"
  | "ALLOCATION_BALANCE_MISMATCH";

export class OrderDomainError extends Error {
  readonly code: OrderDomainCode;
  readonly fieldErrors?: Record<string, string>;
  readonly retryable: boolean;

  constructor(
    code: OrderDomainCode,
    message: string,
    options?: { fieldErrors?: Record<string, string>; retryable?: boolean },
  ) {
    super(message);
    this.name = "OrderDomainError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.retryable = options?.retryable ?? code === "CONCURRENCY_CONFLICT";
  }
}

export function isOrderDomainError(error: unknown): error is OrderDomainError {
  return error instanceof OrderDomainError;
}

export function orderErrorMessage(error: unknown): string {
  if (isOrderDomainError(error)) return error.message;
  return "Something went wrong. Please try again.";
}
