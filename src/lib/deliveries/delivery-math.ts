import { Prisma } from "@/generated/prisma/client";

function d(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function max0(value: Prisma.Decimal): Prisma.Decimal {
  return value.lessThan(0) ? new Prisma.Decimal(0) : value;
}

/** Open ordered capacity (excludes cancelled). */
export function openOrdered(args: {
  quantityOrdered: Prisma.Decimal | number | string;
  quantityCancelled: Prisma.Decimal | number | string;
}): Prisma.Decimal {
  return max0(d(args.quantityOrdered).minus(d(args.quantityCancelled)));
}

/**
 * Qty still available for a new SUBMITTED delivery hold.
 * Unverified SUBMITTED holds + verified received count against the cap.
 */
export function remainingDeliverable(args: {
  quantityOrdered: Prisma.Decimal | number | string;
  quantityCancelled: Prisma.Decimal | number | string;
  quantityVerifiedReceived: Prisma.Decimal | number | string;
  submittedHold: Prisma.Decimal | number | string;
}): Prisma.Decimal {
  return max0(
    openOrdered(args)
      .minus(d(args.quantityVerifiedReceived))
      .minus(d(args.submittedHold)),
  );
}

export function lineStatusAfterVerify(args: {
  quantityOrdered: Prisma.Decimal;
  quantityVerifiedReceived: Prisma.Decimal;
  quantityCancelled: Prisma.Decimal;
}): "ACTIVE" | "PARTIALLY_CANCELLED" | "CANCELLED" | "FULFILLED" {
  const { quantityOrdered, quantityVerifiedReceived, quantityCancelled } = args;
  if (
    quantityVerifiedReceived.plus(quantityCancelled).gte(quantityOrdered) &&
    quantityCancelled.eq(0)
  ) {
    return "FULFILLED";
  }
  if (quantityCancelled.gte(quantityOrdered) && quantityVerifiedReceived.eq(0)) {
    return "CANCELLED";
  }
  if (quantityCancelled.gt(0)) {
    return "PARTIALLY_CANCELLED";
  }
  if (quantityVerifiedReceived.plus(quantityCancelled).gte(quantityOrdered)) {
    return "FULFILLED";
  }
  return "ACTIVE";
}

export function purchaseOrderStatusAfterVerify(args: {
  lines: Array<{
    quantityOrdered: Prisma.Decimal;
    quantityVerifiedReceived: Prisma.Decimal;
    quantityCancelled: Prisma.Decimal;
  }>;
  previousStatus: string;
}): "DELIVERED" | "PARTIALLY_DELIVERED" | "PARTIALLY_CANCELLED" | string {
  const { lines, previousStatus } = args;
  if (lines.length === 0) return previousStatus;

  const allCovered = lines.every((l) =>
    l.quantityVerifiedReceived.plus(l.quantityCancelled).gte(l.quantityOrdered),
  );
  const anyVerified = lines.some((l) => l.quantityVerifiedReceived.gt(0));
  const anyCancelled = lines.some((l) => l.quantityCancelled.gt(0));

  if (allCovered) {
    if (anyCancelled && anyVerified) return "PARTIALLY_CANCELLED";
    if (anyCancelled && !anyVerified) return "CANCELLED";
    return "DELIVERED";
  }
  if (anyVerified) {
    if (previousStatus === "PARTIALLY_CANCELLED") return "PARTIALLY_CANCELLED";
    return "PARTIALLY_DELIVERED";
  }
  return previousStatus;
}

/** Remaining ordered qty not yet verified (includes SUBMITTED holds as not received). */
export function remainingUnverified(args: {
  quantityOrdered: Prisma.Decimal | number | string;
  quantityCancelled: Prisma.Decimal | number | string;
  quantityVerifiedReceived: Prisma.Decimal | number | string;
}): Prisma.Decimal {
  return max0(
    openOrdered(args).minus(d(args.quantityVerifiedReceived)),
  );
}

/**
 * True when adding `quantityToVerify` would keep verified ≤ net ordered.
 * Call after locking the order line.
 */
export function verifiedWouldExceedOpenOrdered(args: {
  quantityOrdered: Prisma.Decimal | number | string;
  quantityCancelled: Prisma.Decimal | number | string;
  quantityVerifiedReceived: Prisma.Decimal | number | string;
  quantityToVerify: Prisma.Decimal | number | string;
}): boolean {
  const next = d(args.quantityVerifiedReceived).plus(d(args.quantityToVerify));
  return next.greaterThan(openOrdered(args));
}
