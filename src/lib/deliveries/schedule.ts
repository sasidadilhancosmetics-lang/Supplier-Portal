import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireSupplier } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import {
  isPastPortalCalendarDate,
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
  claimScheduleIdempotency,
  completeScheduleIdempotency,
  hashScheduleDeliveryPayload,
  type ScheduleDeliveryIdempotencyResult,
} from "./idempotency";
import { lockOrderItemsForUpdate, lockPurchaseOrderForUpdate } from "./locks";
import { resolveCompanyDeliveryNotificationRecipients } from "./notifications";
import {
  scheduleDeliveryInputSchema,
  type ScheduleDeliveryInput,
} from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

async function scheduleOnce(
  user: ProvisionedAppUser,
  input: ScheduleDeliveryInput,
): Promise<ScheduleDeliveryIdempotencyResult> {
  const requestHash = hashScheduleDeliveryPayload({
    purchaseOrderId: input.purchaseOrderId,
    plannedDeliveryAt: input.plannedDeliveryAt,
    notes: input.notes,
    lines: input.lines,
  });
  const now = new Date();
  const plannedDeliveryAt = parseCalendarDateInput(input.plannedDeliveryAt);
  if (!plannedDeliveryAt) {
    throw new DeliveryDomainError("VALIDATION", "Invalid planned delivery date.");
  }
  if (isPastPortalCalendarDate(input.plannedDeliveryAt, now)) {
    throw new DeliveryDomainError(
      "VALIDATION",
      "Planned delivery date cannot be in the past.",
      {
        fieldErrors: {
          plannedDeliveryAt: "Choose today or a future date.",
        },
      },
    );
  }

  const lineMap = new Map<string, Prisma.Decimal>();
  for (const line of input.lines) {
    if (lineMap.has(line.orderItemId)) {
      throw new DeliveryDomainError(
        "VALIDATION",
        "Duplicate order lines in one schedule are not allowed.",
      );
    }
    lineMap.set(line.orderItemId, new Prisma.Decimal(line.quantity));
  }

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimScheduleIdempotency(tx, {
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
            },
          },
        },
      });
      if (!po) {
        throw new DeliveryDomainError("NOT_FOUND", "Purchase order not found.");
      }

      if (
        po.status !== "CONFIRMED" &&
        po.status !== "PARTIALLY_DELIVERED" &&
        po.status !== "PARTIALLY_CANCELLED"
      ) {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "Deliveries can only be scheduled for confirmed purchase orders.",
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

      const holds = await loadSubmittedDeliveryHolds(
        tx,
        po.items.map((i) => i.id),
      );
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
          "Planned quantities exceed remaining ordered quantity.",
          { fieldErrors },
        );
      }

      const deliveryId = createId();
      try {
        await tx.delivery.create({
          data: {
            id: deliveryId,
            purchaseOrderId: po.id,
            companyId: po.companyId,
            supplierId: po.supplierId,
            status: "SCHEDULED",
            idempotencyKey: input.idempotencyKey,
            plannedDeliveryAt,
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
        action: "DELIVERY_SCHEDULED",
        afterJson: {
          purchaseOrderId: po.id,
          plannedDeliveryAt: plannedDeliveryAt.toISOString(),
          lines: [...lineMap.entries()].map(([orderItemId, qty]) => ({
            orderItemId,
            quantityPlanned: qty.toString(),
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
          title: "Delivery scheduled",
          body: `Supplier scheduled a delivery for purchase order ${orderNumber}.`,
          entityType: "Delivery",
          entityId: deliveryId,
        });
      }

      const result: ScheduleDeliveryIdempotencyResult = {
        deliveryId,
        purchaseOrderId: po.id,
        status: "SCHEDULED",
      };
      await completeScheduleIdempotency(tx, {
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

export async function scheduleDelivery(raw: unknown) {
  const parsed = scheduleDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    throw new DeliveryDomainError("VALIDATION", "Invalid delivery schedule.", {
      fieldErrors,
    });
  }

  const user = await requireSupplier();
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await scheduleOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

export async function scheduleDeliveryForUser(
  user: ProvisionedAppUser,
  raw: unknown,
) {
  const parsed = scheduleDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError("VALIDATION", "Invalid delivery schedule.");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await scheduleOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}
