export type CosmoIngestErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "COMPANY_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "VALIDATION"
  | "TEMPORARY_UNAVAILABLE";

export class CosmoIngestError extends Error {
  readonly code: CosmoIngestErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    code: CosmoIngestErrorCode,
    message: string,
    opts?: { httpStatus?: number; details?: unknown; retryable?: boolean },
  ) {
    super(message);
    this.name = "CosmoIngestError";
    this.code = code;
    this.details = opts?.details;
    this.retryable = opts?.retryable ?? false;
    this.httpStatus =
      opts?.httpStatus ??
      ({
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        COMPANY_MISMATCH: 409,
        IDEMPOTENCY_CONFLICT: 409,
        IDEMPOTENCY_IN_PROGRESS: 409,
        VALIDATION: 422,
        TEMPORARY_UNAVAILABLE: 503,
      }[code] as number);
  }
}

export function cosmoErrorResponse(error: CosmoIngestError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
      ...(error.retryable ? { retryable: true } : {}),
    },
  };
}
