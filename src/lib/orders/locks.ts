import { Prisma } from "@/generated/prisma/client";

/**
 * Lock requirement items in sorted id order (requirement-level serialization).
 */
export async function lockRequirementItemsForUpdate(
  tx: Prisma.TransactionClient,
  requirementItemIds: string[],
) {
  const ids = [...new Set(requirementItemIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "RequirementItem"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `;
}

/**
 * Lock availability offers in sorted id order (after requirement locks).
 */
export async function lockAvailabilityOffersForUpdate(
  tx: Prisma.TransactionClient,
  offerIds: string[],
) {
  const ids = [...new Set(offerIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "AvailabilityOffer"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `;
}

/**
 * Lock purchase order row after requirement/offer locks (confirm/cancel serialization).
 */
export async function lockPurchaseOrderForUpdate(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
) {
  await tx.$queryRaw`
    SELECT id FROM "PurchaseOrder"
    WHERE id = ${purchaseOrderId}
    FOR UPDATE
  `;
}
