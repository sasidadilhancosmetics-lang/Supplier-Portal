import type { AvailabilityOfferStatus } from "@/generated/prisma/client";

import { computeReserveExpiresAt } from "./constants";

export type ReserveTimestamps = {
  reservedAt: Date | null;
  reserveExpiresAt: Date | null;
  startedFreshClock: boolean;
};

/**
 * True when an offer currently holds a live allocation reserve.
 * Status alone is insufficient: never treat a past expiry as active.
 */
export function isLiveReserve(
  offer: {
    status: AvailabilityOfferStatus | string;
    reserveExpiresAt: Date | string | null;
  } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!offer || offer.status !== "SUBMITTED" || !offer.reserveExpiresAt) {
    return false;
  }
  const expires =
    offer.reserveExpiresAt instanceof Date
      ? offer.reserveExpiresAt
      : new Date(offer.reserveExpiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
}

/**
 * Resolve reserve timestamps for a submit transition.
 * Fresh 7×24h clock only when entering SUBMITTED from a non-live state.
 * Live SUBMITTED updates preserve the original clock (no extension).
 */
export function resolveReserveOnSubmit(args: {
  nextStatus: AvailabilityOfferStatus;
  quantity: number;
  existing: {
    status: AvailabilityOfferStatus;
    reservedAt: Date | null;
    reserveExpiresAt: Date | null;
  } | null;
  now: Date;
}): ReserveTimestamps {
  const { nextStatus, quantity, existing, now } = args;

  if (nextStatus === "NOT_AVAILABLE" || quantity <= 0) {
    return {
      reservedAt: null,
      reserveExpiresAt: null,
      startedFreshClock: false,
    };
  }

  const wasSubmitted = existing?.status === "SUBMITTED";
  if (wasSubmitted) {
    return {
      reservedAt: existing!.reservedAt,
      reserveExpiresAt: existing!.reserveExpiresAt,
      startedFreshClock: false,
    };
  }

  // DRAFT / EXPIRED / CANCELLED / NOT_AVAILABLE / new row → fresh clock.
  return {
    reservedAt: now,
    reserveExpiresAt: computeReserveExpiresAt(now),
    startedFreshClock: true,
  };
}
