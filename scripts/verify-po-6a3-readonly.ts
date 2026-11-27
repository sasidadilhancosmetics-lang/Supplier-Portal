/**
 * Read-only Stage 6A3 verification against Neon development.
 * Does NOT cancel or mutate any purchase order.
 *
 * Usage (after YOU cancel a disposable test PO in the UI):
 *   npx tsx scripts/verify-po-6a3-readonly.ts PO-YYYYMMDD-XXXXXXXX
 *
 * Pass --before to snapshot a SENT/CONFIRMED test PO before cancel:
 *   npx tsx scripts/verify-po-6a3-readonly.ts PO-... --before
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

const orderNumber = process.argv[2];
const beforeMode = process.argv.includes("--before");

function isCancelAudit(afterJson: unknown): boolean {
  if (!afterJson || typeof afterJson !== "object" || Array.isArray(afterJson)) {
    return false;
  }
  const obj = afterJson as Record<string, unknown>;
  return (
    obj.event === "PURCHASE_ORDER_CANCELLED" ||
    obj.statusAfter === "CANCELLED" ||
    obj.statusAfter === "PARTIALLY_CANCELLED"
  );
}

async function main() {
  if (!orderNumber || orderNumber.startsWith("--")) {
    console.error(
      "Usage: npx tsx scripts/verify-po-6a3-readonly.ts <orderNumber> [--before]",
    );
    process.exitCode = 1;
    return;
  }

  const pos = await prisma.purchaseOrder.findMany({
    where: { orderNumber },
    include: {
      supplier: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { name: true } },
          availabilityOffer: {
            include: {
              requestItem: {
                select: {
                  requirementItem: {
                    select: {
                      id: true,
                      quantityPlanned: true,
                      requirementId: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (pos.length !== 1) {
    console.log(
      JSON.stringify(
        { error: "Expected exactly one PO", orderNumber, poCountByNumber: pos.length },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const po = pos[0]!;
  const item = po.items[0]!;
  const offer = item.availabilityOffer!;
  const requirementItem = offer.requestItem.requirementItem;

  const allocIncreases = await prisma.availabilityChange.findMany({
    where: {
      availabilityOfferId: offer.id,
      changeType: "ORDER_ALLOCATION_INCREASED",
    },
    orderBy: { createdAt: "asc" },
  });
  const firstAlloc = allocIncreases[0];

  const releases = await prisma.availabilityChange.findMany({
    where: {
      availabilityOfferId: offer.id,
      changeType: "ORDER_ALLOCATION_RELEASED",
      // Prefer releases tied to this PO via afterJson when present
    },
    orderBy: { createdAt: "asc" },
  });

  // Release rows store cancelReason in `reason`; prefer match to this PO's reason + time window.
  const releasesForPo = releases.filter((r) => {
    if (po.cancelReason && r.reason === po.cancelReason) return true;
    if (po.cancelledAt) {
      const delta = Math.abs(r.createdAt.getTime() - po.cancelledAt.getTime());
      if (delta <= 5_000) return true;
    }
    return false;
  });

  const audits = await prisma.auditLog.findMany({
    where: { entityType: "PurchaseOrder", entityId: po.id },
    orderBy: { createdAt: "asc" },
  });
  const cancelAudits = audits.filter((a) => isCancelAudit(a.afterJson));

  const notifications = await prisma.notification.findMany({
    where: {
      entityType: "PurchaseOrder",
      entityId: po.id,
      title: "Purchase order cancelled",
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

  const qtyOrdered = Number(item.quantityOrdered);
  const qtyCancelled = Number(item.quantityCancelled);
  const activeNow = Number(offer.quantityOrderedActive);
  const activeAfterAlloc = firstAlloc
    ? Number(firstAlloc.quantityOrderedActiveAfter)
    : null;

  const latestRelease = releasesForPo[releasesForPo.length - 1];
  const releaseDelta =
    latestRelease != null
      ? Number(latestRelease.quantityOrderedActiveBefore) -
        Number(latestRelease.quantityOrderedActiveAfter)
      : null;
  const activeMatchesReleaseAfter =
    latestRelease != null
      ? activeNow === Number(latestRelease.quantityOrderedActiveAfter)
      : false;

  // Uncovered = planned - sum(ordered - cancelled) for this requirement item
  let uncovered: number | null = null;
  if (requirementItem) {
    const siblingItems = await prisma.orderItem.findMany({
      where: {
        availabilityOffer: {
          requestItem: { requirementItemId: requirementItem.id },
        },
      },
      select: {
        quantityOrdered: true,
        quantityCancelled: true,
      },
    });
    const netOrdered = siblingItems.reduce(
      (sum, si) =>
        sum + Number(si.quantityOrdered) - Number(si.quantityCancelled),
      0,
    );
    uncovered = Number(requirementItem.quantityPlanned) - netOrdered;
  }

  // Reserve clock: no change type should rewrite reservedAt/reserveExpiresAt on cancel
  const reservedAt = offer.reservedAt?.toISOString() ?? null;
  const reserveExpiresAt = offer.reserveExpiresAt?.toISOString() ?? null;

  if (beforeMode) {
    console.log(
      JSON.stringify(
        {
          mode: "before_cancel_snapshot",
          warning:
            "Do not cancel existing business POs. Only cancel disposable test orders created for UAT.",
          po: {
            id: po.id,
            orderNumber: po.orderNumber,
            status: po.status,
            version: po.version,
            confirmedAt: po.confirmedAt,
            cancelledAt: po.cancelledAt,
            cancelReason: po.cancelReason,
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
            quantityOrderedActive: offer.quantityOrderedActive.toString(),
            reservedAt,
            reserveExpiresAt,
            allocateActiveAfter: firstAlloc?.quantityOrderedActiveAfter?.toString(),
          },
          coverageHint: {
            quantityPlanned: requirementItem?.quantityPlanned?.toString(),
            uncoveredBeforeCancel: uncovered,
          },
          nextSteps: [
            "Cancel this PO in the supplier UI with a non-empty reason.",
            `Then run: npx tsx scripts/verify-po-6a3-readonly.ts ${orderNumber}`,
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const checks = {
    "1_status_CANCELLED_or_PARTIAL":
      po.status === "CANCELLED" || po.status === "PARTIALLY_CANCELLED",
    "2_cancelledAt_populated": po.cancelledAt != null,
    "3_cancelReason_non_empty":
      typeof po.cancelReason === "string" && po.cancelReason.trim().length > 0,
    "4_quantityOrdered_preserved": qtyOrdered > 0,
    "5_quantityCancelled_equals_ordered_full_cancel":
      po.status === "CANCELLED" ? qtyCancelled === qtyOrdered : qtyCancelled > 0,
    "6_quantityOrderedActive_matches_release_after":
      po.status === "CANCELLED" ? activeMatchesReleaseAfter : true,
    "7_no_negative_active": activeNow >= 0,
    "8_release_change_exists":
      po.status === "CANCELLED" ? releasesForPo.length >= 1 : true,
    "9_release_delta_matches_cancelled":
      po.status === "CANCELLED" && releaseDelta != null
        ? releaseDelta === qtyCancelled
        : true,
    "10_reserve_timestamps_still_set":
      reservedAt != null && reserveExpiresAt != null,
    "11_exactly_one_cancel_audit": cancelAudits.length === 1,
    "12_notifications_deduped_expected_recipients":
      notifUserIds.length === uniqueNotifUsers.size &&
      [...uniqueNotifUsers].every((id) => expectedIds.has(id)) &&
      (expectedIds.size === 0 ||
        [...expectedIds].every((id) => uniqueNotifUsers.has(id))),
    "13_uncovered_non_negative": uncovered == null || uncovered >= 0,
    "14_uncovered_restored_on_full_cancel":
      po.status === "CANCELLED" && requirementItem != null
        ? uncovered === Number(requirementItem.quantityPlanned)
        : true,
  };

  console.log(
    JSON.stringify(
      {
        mode: "after_cancel_verify",
        po: {
          id: po.id,
          orderNumber: po.orderNumber,
          status: po.status,
          version: po.version,
          confirmedAt: po.confirmedAt,
          cancelledAt: po.cancelledAt,
          cancelReason: po.cancelReason,
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
          reservedAt,
          reserveExpiresAt,
          allocateActiveAfter: firstAlloc?.quantityOrderedActiveAfter?.toString(),
          releaseCount: releasesForPo.length,
          latestReleaseDelta: releaseDelta,
          activeMatchesReleaseAfter,
        },
        coverage: {
          quantityPlanned: requirementItem?.quantityPlanned?.toString() ?? null,
          uncovered,
        },
        cancelAudits: cancelAudits.map((a) => ({
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
            email: u.email,
            role: u.role,
            permissions: u.staffPermissions.map((p) => p.code),
          })),
        },
        checks,
        allPass: Object.values(checks).every(Boolean),
        note: "Human UAT is NOT signed off by this script. Confirm UI walkthrough separately.",
      },
      null,
      2,
    ),
  );

  if (!Object.values(checks).every(Boolean)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
