import type { PriceAgreementStatus } from "@/generated/prisma/client";

import { isAgreedPriceStatus } from "@/lib/pricing/status";

/** Agreement statuses that still need staff/supplier price action before allocate. */
export const PRICE_REVIEW_STATUSES = [
  "QUOTED",
  "COUNTER_PENDING",
  "STAFF_RECORDED_UNCONFIRMED",
] as const satisfies readonly PriceAgreementStatus[];

export type SupplierResponseSummary = {
  awaitingResponses: number;
  responsesReceived: number;
  needingPriceReview: number;
  readyForAllocation: number;
};

/**
 * Count distinct request ids — never double-count multi-item requests.
 */
export function uniqueRequestCount(requestIds: string[]): number {
  return new Set(requestIds).size;
}

export function isPriceReviewStatus(
  status: PriceAgreementStatus | null | undefined,
): boolean {
  if (!status) return false;
  return (PRICE_REVIEW_STATUSES as readonly string[]).includes(status);
}

/**
 * Ordinary "Ready for Allocation": submitted offer, live reserve, remaining
 * offer qty, agreed price, and uncovered planned quantity on the requirement.
 *
 * Leftover supplier availability after the plan is fully covered does **not**
 * count as ordinary allocation work. Above-plan buys stay on the explicit
 * allocate path with acknowledgment.
 */
export function offerReadyForAllocation(args: {
  status: string;
  reserveExpiresAt: Date | null;
  quantityDeclared: { toString(): string } | number | string;
  quantityOrderedActive: { toString(): string } | number | string;
  agreementStatus: PriceAgreementStatus | null | undefined;
  /** Uncovered planned qty for the linked requirement item (0 when fully covered). */
  remainingPlanQuantity: { toString(): string } | number | string;
  now: Date;
}): boolean {
  if (args.status !== "SUBMITTED") return false;
  if (
    !args.reserveExpiresAt ||
    args.reserveExpiresAt.getTime() <= args.now.getTime()
  ) {
    return false;
  }
  if (!args.agreementStatus || !isAgreedPriceStatus(args.agreementStatus)) {
    return false;
  }
  const remainingPlan = Number(args.remainingPlanQuantity.toString());
  if (!(remainingPlan > 0)) return false;
  const declared = Number(args.quantityDeclared.toString());
  const ordered = Number(args.quantityOrderedActive.toString());
  return declared - ordered > 0;
}

export function offerNeedsPriceReview(args: {
  status: string;
  unitPrice: { toString(): string } | number | string | null | undefined;
  agreementStatus: PriceAgreementStatus | null | undefined;
}): boolean {
  if (args.status !== "SUBMITTED") return false;
  if (args.agreementStatus && isAgreedPriceStatus(args.agreementStatus)) {
    return false;
  }
  if (isPriceReviewStatus(args.agreementStatus)) return true;
  // Quoted on offer without agreement pointer yet.
  if (args.agreementStatus == null && args.unitPrice != null) return true;
  return false;
}

/** Build summary counts from request status totals + per-offer classifications. */
export function buildSupplierResponseSummary(args: {
  awaitingResponses: number;
  responsesReceived: number;
  needingRequestIds: string[];
  readyRequestIds: string[];
}): SupplierResponseSummary {
  return {
    awaitingResponses: args.awaitingResponses,
    responsesReceived: args.responsesReceived,
    needingPriceReview: uniqueRequestCount(args.needingRequestIds),
    readyForAllocation: uniqueRequestCount(args.readyRequestIds),
  };
}
