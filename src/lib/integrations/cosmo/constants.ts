export const COSMO_OSF_CONTRACT_VERSION = "cosmo-osf-push.v1" as const;

export const COSMO_OSF_MAX_ITEMS = 500;

/** Bounded max Cosmo availability-request suggestions per push (F2A). */
export const COSMO_OSF_MAX_REQUEST_SUGGESTIONS = 2000;

export const COSMO_OSF_IDEMPOTENCY_KEY_MIN = 8;
export const COSMO_OSF_IDEMPOTENCY_KEY_MAX = 128;

/** Prisma Decimal(18, 4) fractional digit limit for suggestedRequestQty. */
export const COSMO_OSF_QTY_DECIMAL_SCALE = 4;

/** Import Review deep link (Phase D UI). Returned to Cosmo on success. */
export function osfImportReviewPath(importId: string): string {
  return `/staff/osf-imports/${importId}`;
}
