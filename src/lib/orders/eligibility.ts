import { Prisma } from "@/generated/prisma/client";

import { remainingOffer } from "./allocation-math";

/** True when an offer can receive a new allocation right now. */
export function isOfferAllocatableNow(
  offer: {
    status: string;
    quantityDeclared: Prisma.Decimal | string | number;
    quantityOrderedActive: Prisma.Decimal | string | number;
    reserveExpiresAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  return remainingOffer({
    status: offer.status,
    quantityDeclared: offer.quantityDeclared,
    quantityOrderedActive: offer.quantityOrderedActive,
    reserveExpiresAt: offer.reserveExpiresAt,
    now,
  }).greaterThan(0);
}

export function allocationIneligibilityReason(
  offer: {
    status: string;
    quantityDeclared: Prisma.Decimal | string | number;
    quantityOrderedActive: Prisma.Decimal | string | number;
    reserveExpiresAt: Date | null;
  } | null,
  now: Date = new Date(),
): string | null {
  if (!offer) return "Awaiting supplier response";
  if (offer.status === "NOT_AVAILABLE") return "Marked not available";
  if (offer.status === "CANCELLED") return "Offer cancelled";
  if (offer.status === "EXPIRED") return "Reserve expired";
  if (offer.status === "DRAFT") return "Draft only (not submitted)";
  if (
    offer.status === "SUBMITTED" &&
    (!offer.reserveExpiresAt ||
      offer.reserveExpiresAt.getTime() <= now.getTime())
  ) {
    return "Reserve expired";
  }
  if (
    offer.status === "SUBMITTED" &&
    remainingOffer({
      status: offer.status,
      quantityDeclared: offer.quantityDeclared,
      quantityOrderedActive: offer.quantityOrderedActive,
      reserveExpiresAt: offer.reserveExpiresAt,
      now,
    }).lessThanOrEqualTo(0)
  ) {
    return "Fully allocated";
  }
  if (offer.status !== "SUBMITTED") return "Not allocatable";
  return null;
}
