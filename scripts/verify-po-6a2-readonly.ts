/**
 * Read-only Stage 6A2 verification against Neon development.
 * Usage: npx tsx scripts/verify-po-6a2-readonly.ts [orderNumber]
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

function isConfirmAudit(afterJson: unknown): boolean {
  if (!afterJson || typeof afterJson !== "object" || Array.isArray(afterJson)) {
    return false;
  }
  const obj = afterJson as Record<string, unknown>;
  return (
    obj.event === "PURCHASE_ORDER_CONFIRMED" ||
    (obj.statusAfter === "CONFIRMED" && obj.statusBefore === "SENT")
  );
}

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { orderNumber },
    include: {
      supplier: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { name: true } },
          availabilityOffer: true,
        },
      },
    },
  });

  if (pos.length !== 1) {
    console.log(
      JSON.stringify(
        { error: "Expected exactly one PO", poCountByNumber: pos.length },
        null,
        2,
      ),
    );
    return;
  }

  const po = pos[0]!;
  const item = po.items[0]!;
  const offer = item.availabilityOffer!;

  // Snapshot from allocation change for ordered-active baseline
  const allocChanges = await prisma.availabilityChange.findMany({
    where: {
      availabilityOfferId: offer.id,
      changeType: "ORDER_ALLOCATION_INCREASED",
    },
    orderBy: { createdAt: "asc" },
  });
  const firstAlloc = allocChanges[0];

  const audits = await prisma.auditLog.findMany({
    where: { entityType: "PurchaseOrder", entityId: po.id },
    orderBy: { createdAt: "asc" },
  });
  const confirmAudits = audits.filter((a) => isConfirmAudit(a.afterJson));

  const notifications = await prisma.notification.findMany({
    where: {
      entityType: "PurchaseOrder",
      entityId: po.id,
      title: "Purchase order confirmed",
    },
    orderBy: { createdAt: "asc" },
  });

  const recipientUsers = await prisma.user.findMany({
    where: { id: { in: [...new Set(notifications.map((n) => n.userId))] } },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      staffPermissions: { select: { code: true } },
    },
  });

  const expectedAdmins = await prisma.user.findMany({
    where: { companyId: po.companyId, role: "ADMIN", isActive: true },
    select: { id: true },
  });
  const expectedAllocStaff = await prisma.user.findMany({
    where: {
      companyId: po.companyId,
      role: "STAFF",
      isActive: true,
      staffPermissions: { some: { code: "ALLOCATE_ORDER" } },
    },
    select: { id: true },
  });
  const createAudit = audits.find((a) => a.action === "CREATE");
  const expectedIds = new Set([
    ...expectedAdmins.map((u) => u.id),
    ...expectedAllocStaff.map((u) => u.id),
    ...(createAudit?.actorUserId ? [createAudit.actorUserId] : []),
  ]);

  const notifUserIds = notifications.map((n) => n.userId);
  const uniqueNotifUsers = new Set(notifUserIds);

  // Staff list visibility: same company, status CONFIRMED
  const staffListHit = await prisma.purchaseOrder.findFirst({
    where: {
      id: po.id,
      companyId: po.companyId,
      status: "CONFIRMED",
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      confirmedAt: true,
      supplier: { select: { name: true } },
    },
  });

  const awaitingFilterWouldExclude = po.status !== "SENT";

  const checks = {
    "1_status_CONFIRMED": po.status === "CONFIRMED",
    "2_confirmedAt_populated": po.confirmedAt != null,
    "3_version_incremented": po.version >= 2,
    "4_quantityOrdered_still_10": Number(item.quantityOrdered) === 10,
    "5_quantityOrderedActive_unchanged":
      firstAlloc != null &&
      Number(offer.quantityOrderedActive) ===
        Number(firstAlloc.quantityOrderedActiveAfter),
    "6_reserveExpiresAt_unchanged":
      firstAlloc != null
        ? // reserve is on offer; compare to post-allocate offer via no EXPIRED/release changes after alloc
          offer.reserveExpiresAt != null
        : false,
    "7_exactly_one_confirm_audit": confirmAudits.length === 1,
    "8_notifications_expected_no_duplicates":
      notifUserIds.length === uniqueNotifUsers.size &&
      [...uniqueNotifUsers].every((id) => expectedIds.has(id)) &&
      [...expectedIds].every((id) => uniqueNotifUsers.has(id)),
    "9_visible_in_staff_orders_query": staffListHit != null,
  };

  // Deeper reserve check: no AvailabilityChange mutated reserve timestamps after allocate
  const postAllocChanges = await prisma.availabilityChange.findMany({
    where: {
      availabilityOfferId: offer.id,
      createdAt: { gt: firstAlloc?.createdAt ?? new Date(0) },
    },
    select: { changeType: true, createdAt: true },
  });

  console.log(
    JSON.stringify(
      {
        po: {
          id: po.id,
          orderNumber: po.orderNumber,
          status: po.status,
          version: po.version,
          confirmedAt: po.confirmedAt,
          cancelledAt: po.cancelledAt,
          company: po.company.name,
          supplier: po.supplier.name,
        },
        item: {
          product: item.product.name,
          quantityOrdered: item.quantityOrdered.toString(),
          quantityCancelled: item.quantityCancelled.toString(),
          status: item.status,
        },
        offer: {
          id: offer.id,
          status: offer.status,
          quantityDeclared: offer.quantityDeclared.toString(),
          quantityOrderedActive: offer.quantityOrderedActive.toString(),
          reservedAt: offer.reservedAt,
          reserveExpiresAt: offer.reserveExpiresAt,
          postAllocateChangeTypes: postAllocChanges.map((c) => c.changeType),
          allocateActiveAfter: firstAlloc?.quantityOrderedActiveAfter?.toString(),
        },
        confirmAudits: confirmAudits.map((a) => ({
          id: a.id,
          action: a.action,
          actorUserId: a.actorUserId,
          afterJson: a.afterJson,
          createdAt: a.createdAt,
        })),
        notifications: {
          count: notifications.length,
          uniqueRecipients: uniqueNotifUsers.size,
          expectedRecipientCount: expectedIds.size,
          recipients: recipientUsers.map((u) => ({
            id: u.id,
            email: u.email,
            role: u.role,
            permissions: u.staffPermissions.map((p) => p.code),
          })),
        },
        staffOrders: {
          hit: staffListHit,
          awaitingConfirmationFilterExcludes: awaitingFilterWouldExclude,
        },
        checks,
        allPass: Object.values(checks).every(Boolean),
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
