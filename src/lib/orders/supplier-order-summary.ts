import { Prisma } from "@/generated/prisma/client";

import { remainingDeliverable } from "@/lib/deliveries/delivery-math";
import {
  orderLinePriceView,
  orderPriceTotalsView,
} from "@/lib/orders/order-pricing";

export type SupplierOrderSummaryLine = {
  quantityOrdered: string | number | { toString(): string };
  quantityCancelled: string | number | { toString(): string };
  quantityVerifiedReceived: string | number | { toString(): string };
  unitPrice: string | number | { toString(): string } | null;
  orderItemId?: string;
};

/**
 * Supplier-facing PO quantity + value summary.
 * Distinguishes remaining-to-receive vs remaining-to-schedule when holds exist.
 */
export function buildSupplierOrderQuantitySummary(args: {
  items: SupplierOrderSummaryLine[];
  currencyCode?: string | null;
  /** Active SUBMITTED + SCHEDULED hold qty by order item id. */
  holdsByOrderItemId?: Map<string, Prisma.Decimal | number | string>;
}) {
  let ordered = new Prisma.Decimal(0);
  let cancelled = new Prisma.Decimal(0);
  let received = new Prisma.Decimal(0);
  let remainingToReceive = new Prisma.Decimal(0);
  let availableToSchedule = new Prisma.Decimal(0);

  for (const item of args.items) {
    const qtyOrdered = new Prisma.Decimal(item.quantityOrdered.toString());
    const qtyCancelled = new Prisma.Decimal(item.quantityCancelled.toString());
    const qtyReceived = new Prisma.Decimal(
      item.quantityVerifiedReceived.toString(),
    );
    const netOrdered = Prisma.Decimal.max(
      0,
      qtyOrdered.minus(qtyCancelled),
    );
    ordered = ordered.plus(qtyOrdered);
    cancelled = cancelled.plus(qtyCancelled);
    received = received.plus(qtyReceived);
    remainingToReceive = remainingToReceive.plus(
      Prisma.Decimal.max(0, netOrdered.minus(qtyReceived)),
    );

    const hold =
      item.orderItemId && args.holdsByOrderItemId
        ? (args.holdsByOrderItemId.get(item.orderItemId) ?? 0)
        : 0;
    availableToSchedule = availableToSchedule.plus(
      remainingDeliverable({
        quantityOrdered: qtyOrdered,
        quantityCancelled: qtyCancelled,
        quantityVerifiedReceived: qtyReceived,
        submittedHold: hold,
      }),
    );
  }

  const lineViews = args.items.map((item) =>
    orderLinePriceView({
      quantityOrdered: item.quantityOrdered.toString(),
      unitPrice: item.unitPrice?.toString() ?? null,
      currencyCode: args.currencyCode,
    }),
  );
  const totals = orderPriceTotalsView(
    lineViews.map((v) => ({ lineTotal: v.lineTotal })),
    args.currencyCode,
  );

  return {
    orderedQty: ordered.toString(),
    cancelledQty: cancelled.toString(),
    receivedQty: received.toString(),
    remainingToReceive: remainingToReceive.toString(),
    availableToSchedule: availableToSchedule.toString(),
    isFullyDelivered:
      remainingToReceive.lte(0) && ordered.gt(0) && cancelled.lt(ordered),
    orderValueLabel: totals.totalLabel,
    hasRecordedPrice: totals.hasAnyPrice,
  };
}
