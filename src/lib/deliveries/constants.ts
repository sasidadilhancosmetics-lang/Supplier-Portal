export const DELIVERY_PAGE_SIZE = 20;

export const DELIVERY_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SUBMIT_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX = "delivery.submit:";
export const SCHEDULE_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX = "delivery.schedule:";
export const RESCHEDULE_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX = "delivery.reschedule:";
export const VERIFY_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX = "delivery.verify:";
export const REJECT_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX = "delivery.reject:";

export const DELIVERY_MAX_TRANSIENT_ATTEMPTS = 3;
export const DELIVERY_NOTES_MAX_LENGTH = 500;
export const RESCHEDULE_REASON_MAX_LENGTH = 500;

export function submitDeliveryIdempotencyScope(actorUserId: string): string {
  return `${SUBMIT_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function scheduleDeliveryIdempotencyScope(actorUserId: string): string {
  return `${SCHEDULE_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function rescheduleDeliveryIdempotencyScope(actorUserId: string): string {
  return `${RESCHEDULE_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function verifyDeliveryIdempotencyScope(actorUserId: string): string {
  return `${VERIFY_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}

export function rejectDeliveryIdempotencyScope(actorUserId: string): string {
  return `${REJECT_DELIVERY_IDEMPOTENCY_SCOPE_PREFIX}${actorUserId}`;
}
