export const ORDER_PAGE_SIZE = 20;

/** Idempotency retention for order mutation keys (clients must retry within this window). */
export const ORDER_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** @deprecated Use ORDER_IDEMPOTENCY_TTL_MS */
export const ALLOCATE_IDEMPOTENCY_TTL_MS = ORDER_IDEMPOTENCY_TTL_MS;

export const ALLOCATE_IDEMPOTENCY_SCOPE_PREFIX = "po.allocate:";
export const CONFIRM_IDEMPOTENCY_SCOPE_PREFIX = "po.confirm:";
export const CANCEL_IDEMPOTENCY_SCOPE_PREFIX = "po.cancel:";

/** Bounded outer retries for recognized transient concurrency failures only. */
export const ALLOCATE_MAX_TRANSIENT_ATTEMPTS = 3;
export const CONFIRM_MAX_TRANSIENT_ATTEMPTS = 3;
export const CANCEL_MAX_TRANSIENT_ATTEMPTS = 3;

export const CANCEL_REASON_MAX_LENGTH = 500;

export function allocateIdempotencyScope(actorUserId: string): string {
  return `${ALLOCATE_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function confirmIdempotencyScope(actorUserId: string): string {
  return `${CONFIRM_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function cancelIdempotencyScope(actorUserId: string): string {
  return `${CANCEL_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}
