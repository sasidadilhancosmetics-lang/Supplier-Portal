import { Prisma } from "@/generated/prisma/client";

import { lockPurchaseOrderForUpdate } from "@/lib/orders/locks";

export { lockPurchaseOrderForUpdate };

/** Lock order lines in sorted id order (after PO lock). */
export async function lockOrderItemsForUpdate(
  tx: Prisma.TransactionClient,
  orderItemIds: string[],
) {
  const ids = [...new Set(orderItemIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "OrderItem"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `;
}

/** Lock a delivery row for verify/reject. */
export async function lockDeliveryForUpdate(
  tx: Prisma.TransactionClient,
  deliveryId: string,
) {
  await tx.$queryRaw`
    SELECT id FROM "Delivery"
    WHERE id = ${deliveryId}
    FOR UPDATE
  `;
}
