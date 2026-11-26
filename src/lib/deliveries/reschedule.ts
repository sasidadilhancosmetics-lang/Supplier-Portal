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
  claimRescheduleIdempotency,
  completeRescheduleIdempotency,
  hashRescheduleDeliveryPayload,
  type RescheduleDeliveryIdempotencyResult,
} from "./idempotency";
import {
  lockDeliveryForUpdate,
  lockOrderItemsForUpdate,
  lockPurchaseOrderForUpdate,
} from "./locks";
import { resolveCompanyDeliveryNotificationRecipients } from "./notifications";
import {
  rescheduleDeliveryInputSchema,
  type RescheduleDeliveryInput,
} from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

async function rescheduleOnce(
  user: ProvisionedAppUser,
  input: RescheduleDeliveryInput,
): Promise<RescheduleDeliveryIdempotencyResult> {
  const requestHash = hashRescheduleDeliveryPayload({
    deliveryId: input.deliveryId,
    plannedDeliveryAt: input.plannedDeliveryAt,
    rescheduleReason: input.rescheduleReason,
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
      const claim = await claimRescheduleIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      const probe = await tx.delivery.findFirst({
        where: {
          id: input.deliveryId,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        select: { id: true, purchaseOrderId: true },
      });
      if (!probe) {
        throw new DeliveryDomainError("NOT_FOUND", "Scheduled delivery not found.");
      }

      await lockPurchaseOrderForUpdate(tx, probe.purchaseOrderId);
      await lockDeliveryForUpdate(tx, probe.id);

      const prior = await tx.delivery.findFirst({
        where: {
          id: probe.id,
          supplierId: user.supplierId!,
          companyId: user.companyId,
        },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              companyId: true,
              supplierId: true,
            },
          },
          items: true,
        },
      });
      if (!prior) {
        throw new DeliveryDomainError("NOT_FOUND", "Scheduled delivery not found.");
      }
      if (prior.status !== "SCHEDULED") {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "Only active schedules can be rescheduled.",
        );
      }

      const po = await tx.purchaseOrder.findFirst({
        where: {
          id: prior.purchaseOrderId,
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
            },
          },
        },
      });
      if (!po) {
        throw new DeliveryDomainError("NOT_FOUND", "Purchase order not found.");
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

      // Release prior SCHEDULED hold first so capacity check uses freed qty.
      await tx.delivery.update({
        where: { id: prior.id },
        data: { status: "SUPERSEDED" },
      });

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
          rescheduleReason: input.rescheduleReason.trim(),
          supersedesDeliveryId: prior.id,
          items: {
            create: [...lineMap.entries()].map(([orderItemId, qty]) => ({
              id: createId(),
              orderItemId,
              quantityDelivered: qty,
            })),
          },
        },
      });

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "Delivery",
        entityId: deliveryId,
        action: "DELIVERY_RESCHEDULED",
        beforeJson: {
          supersededDeliveryId: prior.id,
          priorPlannedDeliveryAt: prior.plannedDeliveryAt?.toISOString() ?? null,
        },
        afterJson: {
          purchaseOrderId: po.id,
          plannedDeliveryAt: plannedDeliveryAt.toISOString(),
          rescheduleReason: input.rescheduleReason.trim(),
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
      const orderNumber = prior.purchaseOrder.orderNumber ?? po.id;
      for (const userId of recipients) {
        await upsertUnreadEntityNotification({
          tx,
          userId,
          title: "Delivery rescheduled",
          body: `Supplier rescheduled a delivery for purchase order ${orderNumber}.`,
          entityType: "Delivery",
          entityId: deliveryId,
        });
      }

      const result: RescheduleDeliveryIdempotencyResult = {
        deliveryId,
        purchaseOrderId: po.id,
        supersededDeliveryId: prior.id,
        status: "SCHEDULED",
      };
      await completeRescheduleIdempotency(tx, {
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

export async function rescheduleDelivery(raw: unknown) {
  const parsed = rescheduleDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    throw new DeliveryDomainError("VALIDATION", "Invalid reschedule request.", {
      fieldErrors,
    });
  }

  const user = await requireSupplier();
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await rescheduleOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

export async function rescheduleDeliveryForUser(
  user: ProvisionedAppUser,
  raw: unknown,
) {
  const parsed = rescheduleDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError("VALIDATION", "Invalid reschedule request.");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await rescheduleOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}
