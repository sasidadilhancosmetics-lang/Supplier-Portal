import { Prisma } from "@/generated/prisma/client";

/**
 * Active capacity holds: legacy SUBMITTED physical submissions + SCHEDULED plans.
 * SUPERSEDED / VERIFIED / REJECTED do not hold.
 */
export async function loadSubmittedDeliveryHolds(
  tx: Prisma.TransactionClient,
  orderItemIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const map = new Map<string, Prisma.Decimal>();
  if (orderItemIds.length === 0) return map;

  const rows = await tx.$queryRaw<
    { orderItemId: string; holdQty: Prisma.Decimal }[]
  >`
    SELECT
      di."orderItemId" AS "orderItemId",
      COALESCE(SUM(di."quantityDelivered"), 0) AS "holdQty"
    FROM "DeliveryItem" di
    INNER JOIN "Delivery" d ON d.id = di."deliveryId"
    WHERE di."orderItemId" IN (${Prisma.join(orderItemIds)})
      AND d.status IN ('SUBMITTED', 'SCHEDULED')
    GROUP BY di."orderItemId"
  `;

  for (const row of rows) {
    map.set(row.orderItemId, new Prisma.Decimal(row.holdQty));
  }
  return map;
}
