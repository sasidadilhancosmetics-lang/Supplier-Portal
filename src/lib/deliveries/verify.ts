import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import {
  requireStaffPermission,
  requireStaffPermissions,
} from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import {
  isFuturePortalCalendarDate,
  parseCalendarDateInput,
} from "@/lib/dates";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { upsertUnreadEntityNotification } from "@/lib/notifications";

import { DELIVERY_MAX_TRANSIENT_ATTEMPTS } from "./constants";
import {
  lineStatusAfterVerify,
  purchaseOrderStatusAfterVerify,
  verifiedWouldExceedOpenOrdered,
} from "./delivery-math";
import { DeliveryDomainError, isDeliveryDomainError } from "./errors";

/** Verify + issue GRN is one atomic action — both grants required for STAFF. */
export const VERIFY_AND_ISSUE_GRN_PERMISSIONS = [
  "VERIFY_DELIVERY",
  "ISSUE_GRN",
] as const;
import { assignUniqueGrnNumber } from "./grn-number";
import {
  claimRejectIdempotency,
  claimVerifyIdempotency,
  completeRejectIdempotency,
  completeVerifyIdempotency,
  hashRejectDeliveryPayload,
  hashVerifyDeliveryPayload,
  type RejectDeliveryIdempotencyResult,
  type VerifyDeliveryIdempotencyResult,
} from "./idempotency";
import {
  lockDeliveryForUpdate,
  lockOrderItemsForUpdate,
  lockPurchaseOrderForUpdate,
} from "./locks";
import { resolveSupplierUsers } from "./notifications";
import {
  rejectDeliveryInputSchema,
  verifyDeliveryInputSchema,
  type RejectDeliveryInput,
  type VerifyDeliveryInput,
} from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

async function loadPendingDelivery(
  tx: Prisma.TransactionClient,
  args: { deliveryId: string; companyId: string },
) {
  return tx.delivery.findFirst({
    where: {
      id: args.deliveryId,
      companyId: args.companyId,
    },
    include: {
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          version: true,
          supplierId: true,
          companyId: true,
          requiresScheduleApproval: true,
        },
      },
      items: {
        include: {
          orderItem: {
            select: {
              id: true,
              productId: true,
              quantityOrdered: true,
              quantityCancelled: true,
              quantityVerifiedReceived: true,
              unitPrice: true,
              status: true,
              product: { select: { name: true, erpItemId: true } },
            },
          },
        },
      },
    },
  });
}

const RECEIPT_PENDING_STATUSES = new Set(["SUBMITTED", "SCHEDULED"]);

async function verifyOnce(
  user: ProvisionedAppUser,
  input: VerifyDeliveryInput,
): Promise<VerifyDeliveryIdempotencyResult> {
  const requestHash = hashVerifyDeliveryPayload({
    deliveryId: input.deliveryId,
    receivedAt: input.receivedAt,
    lines: input.lines,
    discrepancyNotes: input.discrepancyNotes,
  });
  const now = new Date();

  const receivedMap = new Map<string, Prisma.Decimal>();
  for (const line of input.lines) {
    if (receivedMap.has(line.deliveryItemId)) {
      throw new DeliveryDomainError(
        "VALIDATION",
        "Duplicate delivery lines in one verification are not allowed.",
      );
    }
    receivedMap.set(
      line.deliveryItemId,
      new Prisma.Decimal(line.quantityReceived),
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimVerifyIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      const probe = await tx.delivery.findFirst({
        where: { id: input.deliveryId, companyId: user.companyId },
        select: { id: true, purchaseOrderId: true },
      });
      if (!probe) {
        throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
      }

      await lockPurchaseOrderForUpdate(tx, probe.purchaseOrderId);
      await lockDeliveryForUpdate(tx, probe.id);

      const delivery = await loadPendingDelivery(tx, {
        deliveryId: probe.id,
        companyId: user.companyId,
      });
      if (!delivery) {
        throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
      }
      if (!RECEIPT_PENDING_STATUSES.has(delivery.status)) {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "Only scheduled or pending delivery submissions can be verified.",
        );
      }
      if (delivery.purchaseOrder.requiresScheduleApproval && !delivery.scheduleApprovedAt) {
        throw new DeliveryDomainError("INVALID_STATUS", "Approve the proposed delivery schedule before recording receipt.");
      }

      const receivedAtRaw = input.receivedAt?.trim() || "";
      let receivedAt: Date | null = null;
      if (delivery.status === "SCHEDULED" || receivedAtRaw) {
        if (!receivedAtRaw) {
          throw new DeliveryDomainError(
            "VALIDATION",
            "Actual receipt date is required.",
            {
              fieldErrors: {
                receivedAt: "Enter the actual receipt date (today or earlier).",
              },
            },
          );
        }
        receivedAt = parseCalendarDateInput(receivedAtRaw);
        if (!receivedAt) {
          throw new DeliveryDomainError(
            "VALIDATION",
            "Invalid actual receipt date.",
            { fieldErrors: { receivedAt: "Enter a valid date." } },
          );
        }
        if (isFuturePortalCalendarDate(receivedAtRaw, now)) {
          throw new DeliveryDomainError(
            "VALIDATION",
            "Actual receipt date cannot be in the future.",
            {
              fieldErrors: {
                receivedAt: "Choose today or an earlier date.",
              },
            },
          );
        }
      } else if (delivery.deliveredAt) {
        receivedAt = delivery.deliveredAt;
      }

      const orderItemIds = delivery.items.map((i) => i.orderItemId).sort();
      await lockOrderItemsForUpdate(tx, orderItemIds);

      const itemsByDeliveryItemId = new Map(
        delivery.items.map((i) => [i.id, i]),
      );
      let hasDiscrepancy = false;
      const fieldErrors: Record<string, string> = {};
      const plannedLabel =
        delivery.status === "SCHEDULED"
          ? "supplier-scheduled"
          : "supplier-submitted";

      for (const [deliveryItemId, received] of receivedMap) {
        const row = itemsByDeliveryItemId.get(deliveryItemId);
        if (!row) {
          fieldErrors[deliveryItemId] = "Unknown delivery line.";
          continue;
        }
        if (received.greaterThan(row.quantityDelivered)) {
          fieldErrors[deliveryItemId] =
            `Received quantity cannot exceed ${plannedLabel} quantity.`;
        }
        if (!received.eq(row.quantityDelivered)) {
          hasDiscrepancy = true;
        }
      }

      for (const row of delivery.items) {
        if (!receivedMap.has(row.id)) {
          fieldErrors[row.id] = "Received quantity is required for each line.";
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        throw new DeliveryDomainError(
          "VALIDATION",
          "Invalid verification quantities.",
          { fieldErrors },
        );
      }

      if (hasDiscrepancy && !input.discrepancyNotes?.trim()) {
        throw new DeliveryDomainError(
          "DISCREPANCY_NOTES_REQUIRED",
          "Add discrepancy notes when received quantities differ from the planned/submitted quantity (including zero received).",
        );
      }

      // Explicit zero across all lines is allowed with discrepancy notes.
      // Empty inputs are rejected earlier by schema / field checks.

      // Validate net-ordered caps on locked rows before any status / GRN writes.
      const lockedLines = await tx.orderItem.findMany({
        where: { id: { in: orderItemIds } },
        select: {
          id: true,
          quantityOrdered: true,
          quantityCancelled: true,
          quantityVerifiedReceived: true,
          unitPrice: true,
          status: true,
        },
      });
      const lockedById = new Map(lockedLines.map((l) => [l.id, l]));

      for (const row of delivery.items) {
        const received = receivedMap.get(row.id)!;
        if (received.lte(0)) continue;
        const locked = lockedById.get(row.orderItemId);
        if (!locked) {
          throw new DeliveryDomainError(
            "NOT_FOUND",
            "Order line not found during verification.",
          );
        }
        if (
          verifiedWouldExceedOpenOrdered({
            quantityOrdered: locked.quantityOrdered,
            quantityCancelled: locked.quantityCancelled,
            quantityVerifiedReceived: locked.quantityVerifiedReceived,
            quantityToVerify: received,
          })
        ) {
          throw new DeliveryDomainError(
            "OVER_DELIVERY",
            "Verified quantity would exceed net ordered quantity for a line.",
            {
              fieldErrors: {
                [row.id]: "Exceeds remaining net ordered quantity.",
              },
            },
          );
        }
        // Accumulate within this delivery when multiple lines share an order item.
        lockedById.set(row.orderItemId, {
          ...locked,
          quantityVerifiedReceived:
            locked.quantityVerifiedReceived.plus(received),
        });
      }

      // Duplicate GRN guard: Delivery.grn is 1:1; refuse if already issued.
      const existingGrn = await tx.grn.findUnique({
        where: { deliveryId: delivery.id },
        select: { id: true },
      });
      if (existingGrn) {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "A GRN already exists for this delivery.",
        );
      }

      const notes = [
        delivery.notes?.trim() || null,
        hasDiscrepancy
          ? `Discrepancy: ${input.discrepancyNotes!.trim()}`
          : input.discrepancyNotes?.trim() || null,
      ]
        .filter(Boolean)
        .join("\n");

      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "VERIFIED",
          verifiedAt: now,
          verifiedById: user.id,
          receivedAt,
          notes: notes || null,
        },
      });

      const grnLines: Array<{
        productId: string;
        quantityReceived: Prisma.Decimal;
        productName: string | null;
        erpItemId: string | null;
      }> = [];

      for (const row of delivery.items) {
        const received = receivedMap.get(row.id)!;
        if (received.lte(0)) continue;

        const priceBefore = row.orderItem.unitPrice;
        const updated = await tx.orderItem.update({
          where: { id: row.orderItemId },
          data: {
            quantityVerifiedReceived: {
              increment: received,
            },
          },
          select: {
            id: true,
            quantityOrdered: true,
            quantityCancelled: true,
            quantityVerifiedReceived: true,
            unitPrice: true,
          },
        });

        // Price snapshots on OrderItem must remain immutable through verification.
        if (
          priceBefore != null &&
          updated.unitPrice != null &&
          !priceBefore.equals(updated.unitPrice)
        ) {
          throw new DeliveryDomainError(
            "CONCURRENCY_CONFLICT",
            "Order line price snapshot changed unexpectedly during verification.",
            { retryable: true },
          );
        }

        const nextStatus = lineStatusAfterVerify({
          quantityOrdered: updated.quantityOrdered,
          quantityVerifiedReceived: updated.quantityVerifiedReceived,
          quantityCancelled: updated.quantityCancelled,
        });
        if (nextStatus !== row.orderItem.status) {
          await tx.orderItem.update({
            where: { id: row.orderItemId },
            data: { status: nextStatus },
          });
        }

        grnLines.push({
          productId: row.orderItem.productId,
          quantityReceived: received,
          productName: row.orderItem.product.name,
          erpItemId: row.orderItem.product.erpItemId,
        });
      }

      const refreshedItems = await tx.orderItem.findMany({
        where: { purchaseOrderId: delivery.purchaseOrderId },
        select: {
          quantityOrdered: true,
          quantityCancelled: true,
          quantityVerifiedReceived: true,
        },
      });
      const nextPoStatus = purchaseOrderStatusAfterVerify({
        lines: refreshedItems,
        previousStatus: delivery.purchaseOrder.status,
      });
      if (nextPoStatus !== delivery.purchaseOrder.status) {
        await tx.purchaseOrder.update({
          where: { id: delivery.purchaseOrderId },
          data: {
            status: nextPoStatus as never,
            version: { increment: 1 },
          },
        });
      }

      const grnId = createId();
      const grnNumber = await assignUniqueGrnNumber(tx);
      await tx.grn.create({
        data: {
          id: grnId,
          deliveryId: delivery.id,
          status: "ISSUED",
          grnNumber,
          issuedAt: now,
          issuedById: user.id,
          notes: hasDiscrepancy
            ? input.discrepancyNotes!.trim()
            : input.discrepancyNotes?.trim() || null,
          items: {
            create: grnLines.map((line) => ({
              id: createId(),
              productId: line.productId,
              quantityReceived: line.quantityReceived,
              productName: line.productName,
              erpItemId: line.erpItemId,
            })),
          },
        },
      });

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "Delivery",
        entityId: delivery.id,
        action: "DELIVERY_VERIFIED",
        afterJson: {
          purchaseOrderId: delivery.purchaseOrderId,
          hasDiscrepancy,
          grnId,
          grnNumber,
          lines: [...receivedMap.entries()].map(([deliveryItemId, qty]) => ({
            deliveryItemId,
            quantityReceived: qty.toString(),
          })),
        },
      });
      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "Grn",
        entityId: grnId,
        action: "GRN_ISSUED",
        afterJson: { deliveryId: delivery.id, grnNumber },
      });

      const supplierUsers = await resolveSupplierUsers(tx, {
        companyId: delivery.companyId,
        supplierId: delivery.supplierId,
      });
      const orderNumber =
        delivery.purchaseOrder.orderNumber ?? delivery.purchaseOrderId;
      for (const userId of supplierUsers) {
        await upsertUnreadEntityNotification({
          tx,
          userId,
          title: hasDiscrepancy
            ? "Delivery verified with discrepancy"
            : "Delivery verified",
          body: hasDiscrepancy
            ? `Company verified delivery for ${orderNumber} with quantity differences. See notes.`
            : `Company verified your delivery for purchase order ${orderNumber}.`,
          entityType: "Delivery",
          entityId: delivery.id,
        });
      }

      const result: VerifyDeliveryIdempotencyResult = {
        deliveryId: delivery.id,
        purchaseOrderId: delivery.purchaseOrderId,
        status: "VERIFIED",
        grnId,
        hasDiscrepancy,
      };
      await completeVerifyIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });
      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      // Receipt + immutable GRN/audit/notifications require several Neon round trips.
      // Match the bounded budget already used by PO allocation and confirmation.
      timeout: 20_000,
    },
  );
}

async function rejectOnce(
  user: ProvisionedAppUser,
  input: RejectDeliveryInput,
): Promise<RejectDeliveryIdempotencyResult> {
  const requestHash = hashRejectDeliveryPayload({
    deliveryId: input.deliveryId,
    discrepancyNotes: input.discrepancyNotes,
  });
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimRejectIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      const probe = await tx.delivery.findFirst({
        where: { id: input.deliveryId, companyId: user.companyId },
        select: { id: true, purchaseOrderId: true },
      });
      if (!probe) {
        throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
      }

      await lockPurchaseOrderForUpdate(tx, probe.purchaseOrderId);
      await lockDeliveryForUpdate(tx, probe.id);

      const delivery = await loadPendingDelivery(tx, {
        deliveryId: probe.id,
        companyId: user.companyId,
      });
      if (!delivery) {
        throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
      }
      if (!RECEIPT_PENDING_STATUSES.has(delivery.status)) {
        throw new DeliveryDomainError(
          "INVALID_STATUS",
          "Only scheduled or pending delivery submissions can be flagged.",
        );
      }

      const notes = [
        delivery.notes?.trim() || null,
        `Discrepancy flagged: ${input.discrepancyNotes.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");

      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "REJECTED",
          verifiedAt: now,
          verifiedById: user.id,
          notes,
        },
      });

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "Delivery",
        entityId: delivery.id,
        action: "DELIVERY_DISCREPANCY_FLAGGED",
        afterJson: {
          purchaseOrderId: delivery.purchaseOrderId,
          discrepancyNotes: input.discrepancyNotes.trim(),
        },
      });

      const supplierUsers = await resolveSupplierUsers(tx, {
        companyId: delivery.companyId,
        supplierId: delivery.supplierId,
      });
      const orderNumber =
        delivery.purchaseOrder.orderNumber ?? delivery.purchaseOrderId;
      for (const userId of supplierUsers) {
        await upsertUnreadEntityNotification({
          tx,
          userId,
          title: "Delivery discrepancy flagged",
          body: `Company flagged a discrepancy on your delivery for ${orderNumber}. Review notes and resubmit if needed.`,
          entityType: "Delivery",
          entityId: delivery.id,
        });
      }

      const result: RejectDeliveryIdempotencyResult = {
        deliveryId: delivery.id,
        purchaseOrderId: delivery.purchaseOrderId,
        status: "REJECTED",
      };
      await completeRejectIdempotency(tx, {
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

export async function verifyDelivery(raw: unknown) {
  const parsed = verifyDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError("VALIDATION", "Invalid verification input.");
  }
  // Auth before any write: both VERIFY_DELIVERY and ISSUE_GRN (ADMIN bypasses).
  const user = await requireStaffPermissions(VERIFY_AND_ISSUE_GRN_PERMISSIONS);
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await verifyOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

export async function rejectDelivery(raw: unknown) {
  const parsed = rejectDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError(
      "VALIDATION",
      "Invalid discrepancy flag input.",
    );
  }
  // Reject releases holds only — no GRN — VERIFY_DELIVERY is sufficient.
  const user = await requireStaffPermission("VERIFY_DELIVERY");
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await rejectOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

/**
 * Test/helper entry: caller must already be authorized for VERIFY+ISSUE_GRN
 * (or ADMIN). Does not re-check permissions.
 */
export async function verifyDeliveryForUser(
  user: ProvisionedAppUser,
  raw: unknown,
) {
  const parsed = verifyDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError("VALIDATION", "Invalid verification input.");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await verifyOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

export async function rejectDeliveryForUser(
  user: ProvisionedAppUser,
  raw: unknown,
) {
  const parsed = rejectDeliveryInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryDomainError(
      "VALIDATION",
      "Invalid discrepancy flag input.",
    );
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < DELIVERY_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await rejectOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      if (isDeliveryDomainError(error) && error.retryable) continue;
      if (isTransientPrisma(error)) continue;
      throw error;
    }
  }
  throw lastError;
}
