/**
 * Client-safe helpers for delivery submission idempotency key lifecycle.
 *
 * - One key per submission *operation*.
 * - Keep the same key for retries of the same payload (network/double-submit).
 * - After a successful submit, call {@link rotateDeliveryIdempotencyKey} before
 *   the next delivery against the same order.
 */

export function createDeliveryIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Alias used after a successful delivery so the next submit is a new operation. */
export function rotateDeliveryIdempotencyKey(): string {
  return createDeliveryIdempotencyKey();
}

/** Empty Deliver Now map — never prefill previous quantities. */
export function emptyDeliverNowQuantities(
  orderItemIds: readonly string[],
): Record<string, string> {
  return Object.fromEntries(orderItemIds.map((id) => [id, ""]));
}
