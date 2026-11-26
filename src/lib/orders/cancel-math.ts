import { Prisma } from "@/generated/prisma/client";

/**
 * Qty still safe to cancel on a line (never releases verified or delivery holds).
 */
export function cancellableQuantity(args: {
  quantityOrdered: Prisma.Decimal | number | string;
  quantityVerifiedReceived: Prisma.Decimal | number | string;
  quantityCancelled: Prisma.Decimal | number | string;
  submittedDeliveryHold?: Prisma.Decimal | number | string;
}): Prisma.Decimal {
  const ordered = new Prisma.Decimal(args.quantityOrdered);
  const verified = new Prisma.Decimal(args.quantityVerifiedReceived);
  const cancelled = new Prisma.Decimal(args.quantityCancelled);
  const hold = new Prisma.Decimal(args.submittedDeliveryHold ?? 0);
  const raw = ordered.minus(verified).minus(cancelled).minus(hold);
  return raw.gt(0) ? raw : new Prisma.Decimal(0);
}

export function lineStatusAfterCancel(args: {
  quantityOrdered: Prisma.Decimal;
  quantityVerifiedReceived: Prisma.Decimal;
  quantityCancelled: Prisma.Decimal;
}): "ACTIVE" | "PARTIALLY_CANCELLED" | "CANCELLED" | "FULFILLED" {
  const { quantityOrdered, quantityVerifiedReceived, quantityCancelled } = args;
  if (quantityVerifiedReceived.gte(quantityOrdered) && quantityCancelled.eq(0)) {
    return "FULFILLED";
  }
  if (quantityCancelled.gte(quantityOrdered) && quantityVerifiedReceived.eq(0)) {
    return "CANCELLED";
  }
  if (quantityCancelled.gt(0)) {
    return "PARTIALLY_CANCELLED";
  }
  return "ACTIVE";
}

export function purchaseOrderStatusAfterCancel(args: {
  allLinesFullyCancelledWithoutDelivery: boolean;
  anyVerifiedReceived: boolean;
}): "CANCELLED" | "PARTIALLY_CANCELLED" {
  if (args.allLinesFullyCancelledWithoutDelivery) return "CANCELLED";
  if (args.anyVerifiedReceived) return "PARTIALLY_CANCELLED";
  return "CANCELLED";
}
