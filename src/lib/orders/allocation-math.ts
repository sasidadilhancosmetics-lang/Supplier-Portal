import { Prisma } from "@/generated/prisma/client";

export type DecimalLike = Prisma.Decimal | string | number;

function d(value: DecimalLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal
    ? value
    : new Prisma.Decimal(value);
}

export function max0(value: DecimalLike): Prisma.Decimal {
  const n = d(value);
  return n.lessThan(0) ? new Prisma.Decimal(0) : n;
}

export function remainingPlan(
  quantityPlanned: DecimalLike,
  netOrdered: DecimalLike,
): Prisma.Decimal {
  return max0(d(quantityPlanned).minus(d(netOrdered)));
}

export function remainingOffer(args: {
  status: string;
  quantityDeclared: DecimalLike;
  quantityOrderedActive: DecimalLike;
  reserveExpiresAt: Date | null;
  now: Date;
}): Prisma.Decimal {
  if (args.status !== "SUBMITTED") return new Prisma.Decimal(0);
  if (
    !args.reserveExpiresAt ||
    args.reserveExpiresAt.getTime() <= args.now.getTime()
  ) {
    return new Prisma.Decimal(0);
  }
  return max0(d(args.quantityDeclared).minus(d(args.quantityOrderedActive)));
}

/**
 * Split requested qty against remaining plan (mutates runningRemainingPlan).
 * inPlan + abovePlan = requested (exact Decimal arithmetic).
 */
export function splitAgainstPlan(
  requested: DecimalLike,
  runningRemainingPlan: Prisma.Decimal,
): { inPlan: Prisma.Decimal; abovePlan: Prisma.Decimal; nextRemaining: Prisma.Decimal } {
  const n = d(requested);
  if (n.lessThanOrEqualTo(0)) {
    throw new Error("requested quantity must be positive");
  }
  const inPlan = Prisma.Decimal.min(n, runningRemainingPlan);
  const abovePlan = n.minus(inPlan);
  const nextRemaining = runningRemainingPlan.minus(inPlan);
  return { inPlan, abovePlan, nextRemaining: max0(nextRemaining) };
}
