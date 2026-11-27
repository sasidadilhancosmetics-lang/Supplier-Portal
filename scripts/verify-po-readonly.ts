/**
 * Read-only verification of a Stage 6A1 purchase order against Neon development.
 * Usage: npx tsx scripts/verify-po-readonly.ts [orderNumber]
 */
import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const orderNumber = process.argv[2] || "PO-20261112-E5D42983";

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { orderNumber },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          availabilityOffer: true,
        },
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        poCountByNumber: pos.length,
        summary: pos.map((p) => ({
          id: p.id,
          orderNumber: p.orderNumber,
          status: p.status,
          supplier: p.supplier.name,
          itemCount: p.items.length,
          items: p.items.map((i) => ({
            product: i.product.name,
            quantityOrdered: i.quantityOrdered.toString(),
            expectedDelivery: i.originalExpectedDeliveryAt,
            offerId: i.availabilityOfferId,
          })),
        })),
      },
      null,
      2,
    ),
  );

  if (pos.length !== 1) {
    return;
  }

  const po = pos[0]!;
  const item = po.items[0];
  const offer = item?.availabilityOffer ?? null;

  let requirementCoverage: {
    requirementItemId: string;
    quantityPlanned: number;
    netOrdered: number;
    uncovered: number;
  } | null = null;

  if (offer) {
    const requestItem = await prisma.requestItem.findFirst({
      where: { id: offer.requestItemId },
      include: { requirementItem: true },
    });
    const reqItemId = requestItem?.requirementItemId;
    if (reqItemId && requestItem.requirementItem) {
      const rows = await prisma.$queryRaw<Array<{ net: unknown }>>`
        SELECT COALESCE(SUM(oi."quantityOrdered" - oi."quantityCancelled"), 0) AS net
        FROM "RequestItem" ri
        INNER JOIN "AvailabilityOffer" ao ON ao."requestItemId" = ri.id
        INNER JOIN "OrderItem" oi ON oi."availabilityOfferId" = ao.id
        WHERE ri."requirementItemId" = ${reqItemId}
      `;
      const net = Number(rows[0]?.net ?? 0);
      const planned = Number(requestItem.requirementItem.quantityPlanned);
      requirementCoverage = {
        requirementItemId: reqItemId,
        quantityPlanned: planned,
        netOrdered: net,
        uncovered: Math.max(0, planned - net),
      };
    }
  }

  const remainingAllocatable = offer
    ? Math.max(
        0,
        Number(offer.quantityDeclared) - Number(offer.quantityOrderedActive),
      )
    : null;

  const changes = offer
    ? await prisma.availabilityChange.findMany({
        where: {
          availabilityOfferId: offer.id,
          changeType: "ORDER_ALLOCATION_INCREASED",
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  const orderedQty = item ? Number(item.quantityOrdered) : 0;
  const matchingChange =
    changes.find((c) => {
      if (
        c.quantityOrderedActiveAfter == null ||
        c.quantityOrderedActiveBefore == null
      ) {
        return false;
      }
      return (
        Number(c.quantityOrderedActiveAfter) -
          Number(c.quantityOrderedActiveBefore) ===
        orderedQty
      );
    }) ?? changes[0];

  const audits = await prisma.auditLog.findMany({
    where: { entityType: "PurchaseOrder", entityId: po.id },
    orderBy: { createdAt: "desc" },
  });

  const notifications = await prisma.notification.findMany({
    where: { entityType: "PurchaseOrder", entityId: po.id },
    orderBy: { createdAt: "desc" },
  });

  const recentSupplierPos = await prisma.purchaseOrder.findMany({
    where: {
      supplierId: po.supplierId,
      companyId: po.companyId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const checks = {
    "1_order_exists_once": pos.length === 1,
    "2_offer_ordered_active_includes_10":
      matchingChange != null &&
      Number(matchingChange.quantityOrderedActiveAfter) -
        Number(matchingChange.quantityOrderedActiveBefore) ===
        10,
    "3_remaining_allocatable_is_40": remainingAllocatable === 40,
    "4_requirement_net_ordered_is_10":
      requirementCoverage?.netOrdered === 10,
    "5_uncovered_requirement_is_0": requirementCoverage?.uncovered === 0,
    "6_reserve_expires_present": Boolean(offer?.reserveExpiresAt),
    "7_audit_and_notification":
      audits.length >= 1 && notifications.length >= 1,
    "8_no_duplicate_order_number": pos.length === 1,
  };

  console.log(
    JSON.stringify(
      {
        verification: {
          product: item?.product.name,
          quantityOrdered: item?.quantityOrdered.toString(),
          expectedDelivery: item?.originalExpectedDeliveryAt,
          offer: offer
            ? {
                id: offer.id,
                status: offer.status,
                quantityDeclared: offer.quantityDeclared.toString(),
                quantityOrderedActive: offer.quantityOrderedActive.toString(),
                reservedAt: offer.reservedAt,
                reserveExpiresAt: offer.reserveExpiresAt,
              }
            : null,
          orderedActiveDelta: matchingChange
            ? {
                before: matchingChange.quantityOrderedActiveBefore?.toString(),
                after: matchingChange.quantityOrderedActiveAfter?.toString(),
                delta: (
                  Number(matchingChange.quantityOrderedActiveAfter) -
                  Number(matchingChange.quantityOrderedActiveBefore)
                ).toString(),
              }
            : null,
          remainingAllocatable,
          requirementCoverage,
          auditCount: audits.length,
          audits: audits.map((a) => ({
            action: a.action,
            afterJson: a.afterJson,
            createdAt: a.createdAt,
          })),
          notificationCount: notifications.length,
          notifications: notifications.map((n) => ({
            userId: n.userId,
            title: n.title,
            body: n.body,
            status: n.status,
          })),
          recentSupplierPos,
          checks,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
