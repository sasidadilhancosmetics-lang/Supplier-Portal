import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireSupplier } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import {
  isFuturePortalCalendarDate,
  parseCalendarDateInput,
} from "@/lib/dates";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { upsertUnreadEntityNotification } from "@/lib/notifications";

import { DELIVERY_MAX_TRANSIENT_ATTEMPTS } from "./constants";
import { remainingDeliverable } from "./delivery-math";
import { DeliveryDomainError, isDeliveryDomainError } from "./errors";
import { loadSubmittedDeliveryHolds } from "./holds";
import {
  claimSubmitIdempotency,
  completeSubmitIdempotency,
  hashSubmitDeliveryPayload,
  type SubmitDeliveryIdempotencyResult,
} from "./idempotency";
import { lockOrderItemsForUpdate, lockPurchaseOrderForUpdate } from "./locks";
import { resolveCompanyDeliveryNotificationRecipients } from "./notifications";
import {
  submitDeliveryInputSchema,
  type SubmitDeliveryInput,
} from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

async function submitOnce(
  user: ProvisionedAppUser,
  input: SubmitDeliveryInput,
): Promise<SubmitDeliveryIdempotencyResult> {
  const requestHash = hashSubmitDeliveryPayload({
    purchaseOrderId: input.purchaseOrderId,
    deliveredAt: input.deliveredAt,
    notes: input.notes,
    lines: input.lines,
  });
  const now = new Date();
  const deliveredAt = parseCalendarDateInput(input.deliveredAt);
  if (!deliveredAt) {
    throw new DeliveryDomainError("VALIDATION", "Invalid delivery date.");
  }
  // Actual physical delivery date — reject future days in Asia/Colombo.
  if (isFuturePortalCalendarDate(input.deliveredAt, now)) {
    throw new DeliveryDomainError(
      "VALIDATION",
      "Actual delivery date cannot be in the future.",
      { fieldErrors: { deliveredAt: "Choose today or an earlier date." } },
    );
  }

  const lineMap = new Map<string, Prisma.Decimal>();
  for (const line of input.lines) {
    if (lineMap.has(line.orderItemId)) {
      throw new DeliveryDomainError(
        "VALIDATION",
        "Duplicate order lines in one delivery are not allowed.",
      );
    }
    lineMap.set(line.orderItemId, new Prisma.Decimal(line.quantity));
  }

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimSubmitIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      const owned = await tx.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        select: { id: true },
      });
      if (!owned) {
        throw new DeliveryDomainError("NOT_FOUND", "Purchase order not found.");
      }

      await lockPurchaseOrderForUpdate(tx, owned.id);

      const po = await tx.purchaseOrder.findFirst({
        where: {
          id: owned.id,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        include: {
          items: {
            select: {
              id: true,
              quantityOrdered: true,
              quantityCancelled: true,
              quantityVerifiedReceived: true,
              status: true,
              unitPrice: true,
            },
          },
        },
      });
      if (!po) {
        throw new DeliveryDomainError("NOT_FOUND", "Purchase order not found.");
      }
      if (po.requiresScheduleApproval) {
        throw new DeliveryDomainError("INVALID_STATUS", "Propose a delivery schedule for company approval first.");
      }

      if (
        po.status !== "CONFIRMED" &&
        po.status !== "PARTIALLY_DELIVERED" &&
        po.status !== "PARTIALLY_CANCELLED"
      ) {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "Deliveries can only be submitted for confirmed purchase orders.",
        );
      }

      const itemIds = [...lineMap.keys()].sort();
      await lockOrderItemsForUpdate(tx, itemIds);

      const itemsById = new Map(po.items.map((i) => [i.id, i]));
      for (const id of itemIds) {
        if (!itemsById.has(id)) {
          throw new DeliveryDomainError(
            "VALIDATION",
            "One or more order lines do not belong to this purchase order.",
          );
        }
      }

      const holds = await loadSubmittedDeliveryHolds(tx, po.items.map((i) => i.id));
      const fieldErrors: Record<string, string> = {};

      for (const [orderItemId, qty] of lineMap) {
        const item = itemsById.get(orderItemId)!;
        const remaining = remainingDeliverable({
          quantityOrdered: item.quantityOrdered,
          quantityCancelled: item.quantityCancelled,
          quantityVerifiedReceived: item.quantityVerifiedReceived,
          submittedHold: holds.get(orderItemId) ?? 0,
        });
        if (qty.greaterThan(remaining)) {
          fieldErrors[orderItemId] =
            `Exceeds remaining deliverable quantity (${remaining.toString()}).`;
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw new DeliveryDomainError(
          "OVER_DELIVERY",
          "Submitted quantities exceed remaining ordered quantity.",
          { fieldErrors },
        );
      }

      // Unique per PO + key (schema). Collision with different payload is rare; treat as conflict.
      const deliveryId = createId();
      try {
        await tx.delivery.create({
          data: {
            id: deliveryId,
            purchaseOrderId: po.id,
            companyId: po.companyId,
            supplierId: po.supplierId,
            status: "SUBMITTED",
            idempotencyKey: input.idempotencyKey,
            deliveredAt,
            notes: input.notes?.trim() || null,
            items: {
              create: [...lineMap.entries()].map(([orderItemId, qty]) => ({
                id: createId(),
                orderItemId,
                quantityDelivered: qty,
              })),
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new DeliveryDomainError(
            "CONCURRENCY_CONFLICT",
            "A delivery with this idempotency key already exists for the order.",
            { retryable: true },
          );
        }
        throw error;
      }

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "Delivery",
        entityId: deliveryId,
        action: "DELIVERY_SUBMITTED",
        afterJson: {
          purchaseOrderId: po.id,
          deliveredAt: deliveredAt.toISOString(),
          lines: [...lineMap.entries()].map(([orderItemId, qty]) => ({
            orderItemId,
            quantityDelivered: qty.toString(),
          })),
        },
      });

      const recipients = await resolveCompanyDeliveryNotificationRecipients(
        tx,
        po.companyId,
      );
      const orderNumber = po.orderNumber ?? po.id;
      for (const userId of recipients) {
        await upsertUnreadEntityNotification({
          tx,
          userId,
          title: "Delivery submitted for verification",
          body: `Supplier submitted a delivery for purchase order ${orderNumber}.`,
          entityType: "Delivery",
          entityId: deliveryId,
        });
      }

      const result: SubmitDeliveryIdempotencyResult = {
        deliveryId,
        purchaseOrderId: po.id,
        status: "SUBMITTED",
      };
      await completeSubmitIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function submitDelivery(raw: unknown) {
  const parsed = submitDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    throw new DeliveryDomainError("VALIDATION", "Invalid delivery submission.", {
      fieldErrors,
    });
  }

  const user = await requireSupplier();
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await submitOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

export async function submitDeliveryForUser(
  user: ProvisionedAppUser,
  raw: unknown,
) {
  const parsed = submitDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError("VALIDATION", "Invalid delivery submission.");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await submitOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}
