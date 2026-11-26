import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireSupplier } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import { createUserNotification } from "@/lib/notifications";

import { CONFIRM_MAX_TRANSIENT_ATTEMPTS } from "./constants";
import { OrderDomainError, isOrderDomainError } from "./errors";
import {
  claimConfirmIdempotency,
  completeConfirmIdempotency,
  hashConfirmPayload,
  type ConfirmIdempotencyResult,
} from "./idempotency";
import { lockPurchaseOrderForUpdate } from "./locks";
import { resolveCompanyOrderNotificationRecipients } from "./notifications";
import { confirmOrderInputSchema, type ConfirmOrderInput } from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2028";
}

/** @deprecated Use resolveCompanyOrderNotificationRecipients */
export async function resolveConfirmNotificationRecipients(
  tx: Prisma.TransactionClient,
  args: { companyId: string; purchaseOrderId: string },
): Promise<string[]> {
  return resolveCompanyOrderNotificationRecipients(tx, args);
}

async function confirmOnce(
  user: ProvisionedAppUser,
  input: ConfirmOrderInput,
): Promise<ConfirmIdempotencyResult> {
  const requestHash = hashConfirmPayload({
    purchaseOrderId: input.purchaseOrderId,
  });
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimConfirmIdempotency(tx, {
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
        throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
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
              availabilityOfferId: true,
            },
          },
        },
      });

      if (!po) {
        throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
      }

      if (po.status === "CONFIRMED") {
        throw new OrderDomainError(
          "INVALID_STATUS",
          "This purchase order is already confirmed.",
        );
      }

      if (po.status === "CANCELLED" || po.status === "PARTIALLY_CANCELLED") {
        throw new OrderDomainError(
          "INVALID_STATUS",
          "Cannot confirm a cancelled purchase order.",
        );
      }

      if (po.status !== "SENT") {
        throw new OrderDomainError(
          "INVALID_STATUS",
          `Cannot confirm a purchase order in status ${po.status}.`,
        );
      }

      const quantitySnapshot = po.items.map((i) => ({
        id: i.id,
        quantityOrdered: i.quantityOrdered.toString(),
        quantityCancelled: i.quantityCancelled.toString(),
        availabilityOfferId: i.availabilityOfferId,
      }));

      const claimed = await tx.purchaseOrder.updateMany({
        where: {
          id: po.id,
          supplierId: user.supplierId!,
          companyId: user.companyId,
          status: "SENT",
          version: po.version,
        },
        data: {
          status: "CONFIRMED",
          confirmedAt: now,
          version: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        const latest = await tx.purchaseOrder.findFirst({
          where: {
            id: po.id,
            supplierId: user.supplierId!,
            companyId: user.companyId,
          },
          select: { status: true },
        });
        if (latest?.status === "CANCELLED" || latest?.status === "PARTIALLY_CANCELLED") {
          throw new OrderDomainError(
            "INVALID_STATUS",
            "Purchase order was cancelled before confirmation.",
          );
        }
        if (latest?.status === "CONFIRMED") {
          throw new OrderDomainError(
            "CONCURRENCY_CONFLICT",
            "Another confirmation completed first; retry with a new key only if needed.",
            { retryable: false },
          );
        }
        throw new OrderDomainError(
          "CONCURRENCY_CONFLICT",
          "Purchase order changed during confirmation; retry.",
          { retryable: true },
        );
      }

      const confirmed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          confirmedAt: true,
          companyId: true,
          supplierId: true,
          items: {
            select: {
              id: true,
              quantityOrdered: true,
              quantityCancelled: true,
              availabilityOfferId: true,
            },
          },
        },
      });

      for (const before of quantitySnapshot) {
        const after = confirmed.items.find((i) => i.id === before.id);
        if (
          !after ||
          after.quantityOrdered.toString() !== before.quantityOrdered ||
          after.quantityCancelled.toString() !== before.quantityCancelled ||
          after.availabilityOfferId !== before.availabilityOfferId
        ) {
          throw new OrderDomainError(
            "CONCURRENCY_CONFLICT",
            "Order quantities changed unexpectedly during confirmation.",
            { retryable: true },
          );
        }
      }

      const confirmedAt = confirmed.confirmedAt ?? now;
      const orderNumber = confirmed.orderNumber ?? confirmed.id;

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "PurchaseOrder",
        entityId: confirmed.id,
        action: "UPDATE",
        beforeJson: { status: "SENT" },
        afterJson: {
          event: "PURCHASE_ORDER_CONFIRMED",
          purchaseOrderId: confirmed.id,
          orderNumber,
          companyId: confirmed.companyId,
          supplierId: confirmed.supplierId,
          actorUserId: user.id,
          statusBefore: "SENT",
          statusAfter: "CONFIRMED",
          confirmedAt: confirmedAt.toISOString(),
          idempotencyKey: input.idempotencyKey,
        },
      });

      const recipientIds = await resolveCompanyOrderNotificationRecipients(tx, {
        companyId: confirmed.companyId,
        purchaseOrderId: confirmed.id,
      });

      for (const userId of recipientIds) {
        await createUserNotification({
          tx,
          userId,
          title: "Purchase order confirmed",
          body: `Supplier confirmed purchase order ${orderNumber}.`,
          entityType: "PurchaseOrder",
          entityId: confirmed.id,
        });
      }

      const result: ConfirmIdempotencyResult = {
        purchaseOrderId: confirmed.id,
        orderNumber,
        status: "CONFIRMED",
        confirmedAt: confirmedAt.toISOString(),
      };

      await completeConfirmIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });

      return result;
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export async function confirmPurchaseOrderForUser(
  user: ProvisionedAppUser,
  raw: ConfirmOrderInput,
): Promise<ConfirmIdempotencyResult> {
  const parsed = confirmOrderInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid confirmation request.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]),
      ),
    });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= CONFIRM_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await confirmOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      const retryable =
        (isOrderDomainError(error) && error.retryable) ||
        isTransientPrisma(error);
      if (!retryable || attempt === CONFIRM_MAX_TRANSIENT_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function confirmPurchaseOrder(
  raw: ConfirmOrderInput,
): Promise<ConfirmIdempotencyResult> {
  const user = await requireSupplier();
  return confirmPurchaseOrderForUser(user, raw);
}
