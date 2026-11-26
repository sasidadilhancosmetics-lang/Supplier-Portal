import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireSupplier } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { createUserNotification } from "@/lib/notifications";

import {
  cancellableQuantity,
  lineStatusAfterCancel,
  purchaseOrderStatusAfterCancel,
} from "./cancel-math";
import { CANCEL_MAX_TRANSIENT_ATTEMPTS } from "./constants";
import { OrderDomainError, isOrderDomainError } from "./errors";
import {
  claimCancelIdempotency,
  completeCancelIdempotency,
  hashCancelPayload,
  type CancelIdempotencyResult,
} from "./idempotency";
import {
  lockAvailabilityOffersForUpdate,
  lockPurchaseOrderForUpdate,
  lockRequirementItemsForUpdate,
} from "./locks";
import { resolveCompanyOrderNotificationRecipients } from "./notifications";
import { cancelOrderInputSchema, type CancelOrderInput } from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

async function loadSubmittedDeliveryHolds(
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

async function cancelOnce(
  user: ProvisionedAppUser,
  input: CancelOrderInput,
): Promise<CancelIdempotencyResult> {
  const requestHash = hashCancelPayload({
    purchaseOrderId: input.purchaseOrderId,
    cancelReason: input.cancelReason,
  });
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimCancelIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      // Ownership probe before locks (cheap NOT_FOUND for cross-supplier).
      const owned = await tx.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        select: {
          id: true,
          items: {
            select: {
              id: true,
              availabilityOfferId: true,
              availabilityOffer: {
                select: {
                  id: true,
                  requestItem: {
                    select: { requirementItemId: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!owned) {
        throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
      }

      const offerIds = owned.items
        .map((i) => i.availabilityOfferId)
        .filter((id): id is string => Boolean(id));
      const requirementItemIds = owned.items
        .map((i) => i.availabilityOffer?.requestItem.requirementItemId)
        .filter((id): id is string => Boolean(id));

      // Lock order compatible with allocate: requirements → offers → PO.
      await lockRequirementItemsForUpdate(tx, requirementItemIds);
      await lockAvailabilityOffersForUpdate(tx, offerIds);
      await lockPurchaseOrderForUpdate(tx, owned.id);

      const po = await tx.purchaseOrder.findFirst({
        where: {
          id: owned.id,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        include: {
          items: {
            include: {
              availabilityOffer: true,
            },
          },
        },
      });
      if (!po) {
        throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
      }

      if (po.status === "CANCELLED" || po.status === "PARTIALLY_CANCELLED") {
        throw new OrderDomainError(
          "INVALID_STATUS",
          "This purchase order is already cancelled.",
        );
      }

      if (po.status !== "SENT" && po.status !== "CONFIRMED") {
        throw new OrderDomainError(
          "INVALID_STATUS",
          `Cannot cancel a purchase order in status ${po.status}.`,
        );
      }

      const statusBefore = po.status;
      const holds = await loadSubmittedDeliveryHolds(
        tx,
        po.items.map((i) => i.id),
      );

      for (const item of po.items) {
        const hold = holds.get(item.id) ?? new Prisma.Decimal(0);
        if (hold.gt(0)) {
          throw new OrderDomainError(
            "DELIVERY_HOLD",
            "Cannot cancel while active delivery submissions hold quantity. Resolve deliveries first.",
          );
        }
      }

      const linePlans: {
        itemId: string;
        offerId: string | null;
        releaseQty: Prisma.Decimal;
        newCancelled: Prisma.Decimal;
        newLineStatus: ReturnType<typeof lineStatusAfterCancel>;
        ordered: Prisma.Decimal;
        verified: Prisma.Decimal;
      }[] = [];

      let releasedTotal = new Prisma.Decimal(0);
      let anyVerified = false;
      let allFullyCancelledNoDelivery = true;

      for (const item of po.items) {
        const ordered = new Prisma.Decimal(item.quantityOrdered);
        const verified = new Prisma.Decimal(item.quantityVerifiedReceived);
        const cancelled = new Prisma.Decimal(item.quantityCancelled);
        if (verified.gt(0)) anyVerified = true;

        const releaseQty = cancellableQuantity({
          quantityOrdered: ordered,
          quantityVerifiedReceived: verified,
          quantityCancelled: cancelled,
          submittedDeliveryHold: 0,
        });

        if (releaseQty.lte(0) && verified.eq(0) && cancelled.gte(ordered)) {
          // Already fully cancelled line — skip
          continue;
        }

        const newCancelled = cancelled.plus(releaseQty);
        const newLineStatus = lineStatusAfterCancel({
          quantityOrdered: ordered,
          quantityVerifiedReceived: verified,
          quantityCancelled: newCancelled,
        });

        if (!(newCancelled.gte(ordered) && verified.eq(0))) {
          allFullyCancelledNoDelivery = false;
        }

        if (releaseQty.gt(0)) {
          releasedTotal = releasedTotal.plus(releaseQty);
          linePlans.push({
            itemId: item.id,
            offerId: item.availabilityOfferId,
            releaseQty,
            newCancelled,
            newLineStatus,
            ordered,
            verified,
          });
        } else if (verified.gt(0)) {
          allFullyCancelledNoDelivery = false;
        }
      }

      if (releasedTotal.lte(0)) {
        throw new OrderDomainError(
          "NOTHING_TO_CANCEL",
          "There is no remaining undelivered quantity to cancel.",
        );
      }

      const newPoStatus = purchaseOrderStatusAfterCancel({
        allLinesFullyCancelledWithoutDelivery: allFullyCancelledNoDelivery,
        anyVerifiedReceived: anyVerified,
      });

      // Claim header transition under lock (serialize vs confirm / other cancel).
      const claimed = await tx.purchaseOrder.updateMany({
        where: {
          id: po.id,
          supplierId: user.supplierId!,
          companyId: user.companyId,
          status: { in: ["SENT", "CONFIRMED"] },
          version: po.version,
        },
        data: {
          status: newPoStatus,
          cancelledAt: now,
          cancelReason: input.cancelReason,
          version: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        throw new OrderDomainError(
          "CONCURRENCY_CONFLICT",
          "Purchase order changed during cancellation; retry.",
          { retryable: true },
        );
      }

      // Release per offer (aggregate releases for same offer).
      const releaseByOffer = new Map<string, Prisma.Decimal>();
      for (const plan of linePlans) {
        await tx.orderItem.update({
          where: { id: plan.itemId },
          data: {
            quantityCancelled: plan.newCancelled,
            status: plan.newLineStatus,
            cancelledAt: now,
            cancelReason: input.cancelReason,
          },
        });
        if (plan.offerId) {
          const prev = releaseByOffer.get(plan.offerId) ?? new Prisma.Decimal(0);
          releaseByOffer.set(plan.offerId, prev.plus(plan.releaseQty));
        }
      }

      const offerSnapshots: {
        offerId: string;
        status: string;
        reservedAt: Date | null;
        reserveExpiresAt: Date | null;
        before: string;
        after: string;
        released: string;
      }[] = [];

      for (const [offerId, releaseQty] of [...releaseByOffer.entries()].sort(
        (a, b) => a[0].localeCompare(b[0]),
      )) {
        // Offers are already locked (FOR UPDATE). Still enforce the balance
        // atomically so we never clamp a negative allocation to zero.
        const offer = await tx.availabilityOffer.findUniqueOrThrow({
          where: { id: offerId },
        });

        const beforeActive = new Prisma.Decimal(offer.quantityOrderedActive);
        if (beforeActive.lt(releaseQty)) {
          throw new OrderDomainError(
            "ALLOCATION_BALANCE_MISMATCH",
            `Cannot release ${releaseQty.toString()} from offer allocation balance ${beforeActive.toString()}.`,
          );
        }

        const afterActive = beforeActive.minus(releaseQty);

        const released = await tx.availabilityOffer.updateMany({
          where: {
            id: offerId,
            quantityOrderedActive: { gte: releaseQty },
            version: offer.version,
          },
          data: {
            quantityOrderedActive: afterActive,
            version: { increment: 1 },
          },
        });

        if (released.count !== 1) {
          // Under FOR UPDATE this should not happen after the explicit balance check.
          // Fail closed without clamping; do not retry (would risk masking corruption).
          throw new OrderDomainError(
            "ALLOCATION_BALANCE_MISMATCH",
            "Offer allocation balance changed during cancellation; cannot release safely.",
          );
        }

        // Never reactivate EXPIRED/CANCELLED; never touch reserve clocks.
        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: offerId,
            actorUserId: user.id,
            changeType: "ORDER_ALLOCATION_RELEASED",
            quantityOrderedActiveBefore: beforeActive,
            quantityOrderedActiveAfter: afterActive,
            statusBefore: offer.status,
            statusAfter: offer.status,
            reason: input.cancelReason,
          },
        });

        offerSnapshots.push({
          offerId,
          status: offer.status,
          reservedAt: offer.reservedAt,
          reserveExpiresAt: offer.reserveExpiresAt,
          before: beforeActive.toString(),
          after: afterActive.toString(),
          released: releaseQty.toString(),
        });
      }

      const orderNumber = po.orderNumber ?? po.id;
      const releasedLines = linePlans.map((p) => ({
        orderItemId: p.itemId,
        releasedQuantity: p.releaseQty.toString(),
        quantityCancelledAfter: p.newCancelled.toString(),
        lineStatusAfter: p.newLineStatus,
      }));

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "PurchaseOrder",
        entityId: po.id,
        action: "UPDATE",
        beforeJson: { status: statusBefore },
        afterJson: {
          event: "PURCHASE_ORDER_CANCELLED",
          purchaseOrderId: po.id,
          orderNumber,
          companyId: po.companyId,
          supplierId: po.supplierId,
          actorUserId: user.id,
          statusBefore,
          statusAfter: newPoStatus,
          cancelReason: input.cancelReason,
          cancelledAt: now.toISOString(),
          releasedQuantityTotal: releasedTotal.toString(),
          releasedLines,
          offerReleases: offerSnapshots.map((o) => ({
            offerId: o.offerId,
            released: o.released,
            quantityOrderedActiveBefore: o.before,
            quantityOrderedActiveAfter: o.after,
            offerStatus: o.status,
          })),
          idempotencyKey: input.idempotencyKey,
        },
      });

      const recipientIds = await resolveCompanyOrderNotificationRecipients(tx, {
        companyId: po.companyId,
        purchaseOrderId: po.id,
      });

      for (const userId of recipientIds) {
        await createUserNotification({
          tx,
          userId,
          title: "Purchase order cancelled",
          body: `Supplier cancelled purchase order ${orderNumber}: ${input.cancelReason}`,
          entityType: "PurchaseOrder",
          entityId: po.id,
        });
      }

      const result: CancelIdempotencyResult = {
        purchaseOrderId: po.id,
        orderNumber,
        status: newPoStatus,
        cancelledAt: now.toISOString(),
        cancelReason: input.cancelReason,
        releasedQuantityTotal: releasedTotal.toString(),
      };

      await completeCancelIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });

      return result;
    },
    { maxWait: 10_000, timeout: 25_000 },
  );
}

export async function cancelPurchaseOrderForUser(
  user: ProvisionedAppUser,
  raw: CancelOrderInput,
): Promise<CancelIdempotencyResult> {
  const parsed = cancelOrderInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid cancellation request.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]),
      ),
    });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= CANCEL_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await cancelOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      const retryable =
        (isOrderDomainError(error) && error.retryable) ||
        isTransientPrisma(error);
      if (!retryable || attempt === CANCEL_MAX_TRANSIENT_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function cancelPurchaseOrder(
  raw: CancelOrderInput,
): Promise<CancelIdempotencyResult> {
  const user = await requireSupplier();
  return cancelPurchaseOrderForUser(user, raw);
}
