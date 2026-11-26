import { Prisma } from "@/generated/prisma/client";

import { remainingPlan } from "./allocation-math";

export type RequirementCoverage = {
  requirementItemId: string;
  quantityPlanned: Prisma.Decimal;
  netOrdered: Prisma.Decimal;
  remainingPlan: Prisma.Decimal;
};

/**
 * Post-lock coverage for requirement items (all suppliers' order lines).
 */
export async function loadRequirementCoverage(
  tx: Prisma.TransactionClient,
  requirementItemIds: string[],
): Promise<Map<string, RequirementCoverage>> {
  const ids = [...new Set(requirementItemIds)];
  const map = new Map<string, RequirementCoverage>();
  if (ids.length === 0) return map;

  const items = await tx.requirementItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, quantityPlanned: true },
  });

  for (const item of items) {
    map.set(item.id, {
      requirementItemId: item.id,
      quantityPlanned: item.quantityPlanned,
      netOrdered: new Prisma.Decimal(0),
      remainingPlan: remainingPlan(item.quantityPlanned, 0),
    });
  }

  // Aggregate net ordered via RequestItem → Offer → OrderItem.
  const rows = await tx.$queryRaw<
    { requirementItemId: string; netOrdered: Prisma.Decimal }[]
  >`
    SELECT
      ri."requirementItemId" AS "requirementItemId",
      COALESCE(
        SUM(oi."quantityOrdered" - oi."quantityCancelled"),
        0
      ) AS "netOrdered"
    FROM "RequestItem" ri
    INNER JOIN "AvailabilityOffer" ao ON ao."requestItemId" = ri.id
    INNER JOIN "OrderItem" oi ON oi."availabilityOfferId" = ao.id
    WHERE ri."requirementItemId" IN (${Prisma.join(ids)})
    GROUP BY ri."requirementItemId"
  `;

  for (const row of rows) {
    const current = map.get(row.requirementItemId);
    if (!current) continue;
    const net = new Prisma.Decimal(row.netOrdered);
    map.set(row.requirementItemId, {
      ...current,
      netOrdered: net,
      remainingPlan: remainingPlan(current.quantityPlanned, net),
    });
  }

  return map;
}
