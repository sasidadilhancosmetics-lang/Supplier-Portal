/** Reserve validity: reservedAt + 7 × 24 hours (UTC). */
export const RESERVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REQUEST_PAGE_SIZE = 20;

export function computeReserveExpiresAt(reservedAt: Date): Date {
  return new Date(reservedAt.getTime() + RESERVE_TTL_MS);
}
