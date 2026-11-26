import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toCalendarDateInputValue } from "@/lib/dates";

export async function loadDateAllocations(
  tx: Prisma.TransactionClient,
  offerId: string,
  companyId: string,
  supplierId: string,
) {
  const committed = await tx.orderItem.groupBy({
    by: ["originalExpectedDeliveryAt"],
    where: { availabilityOfferId: offerId, companyId, supplierId },
    _sum: { quantityOrdered: true, quantityCancelled: true },
  });
  return new Map(committed.map((row) => [
    toCalendarDateInputValue(row.originalExpectedDeliveryAt),
    new Prisma.Decimal(row._sum.quantityOrdered ?? 0).minus(row._sum.quantityCancelled ?? 0),
  ]));
}
