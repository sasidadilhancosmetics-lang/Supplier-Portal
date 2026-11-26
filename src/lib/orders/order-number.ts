import { randomBytes } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { OrderDomainError } from "./errors";

function stamp(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Company-scoped unique order number candidate. */
export function generateOrderNumberCandidate(now = new Date()): string {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `PO-${stamp(now)}-${suffix}`;
}

/**
 * Create PurchaseOrder with retry on company-scoped orderNumber unique conflicts.
 */
export async function createPurchaseOrderWithUniqueNumber(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    companyId: string;
    supplierId: string;
    status: "SENT";
    currencyCode?: string | null;
    requiresScheduleApproval?: boolean;
  },
  attempts = 5,
): Promise<{ id: string; orderNumber: string }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const orderNumber = generateOrderNumberCandidate();
    try {
      const po = await tx.purchaseOrder.create({
        data: {
          id: data.id,
          companyId: data.companyId,
          supplierId: data.supplierId,
          status: data.status,
          orderNumber,
          currencyCode: data.currencyCode ?? null,
          requiresScheduleApproval: data.requiresScheduleApproval,
          version: 1,
        },
        select: { id: true, orderNumber: true },
      });
      if (!po.orderNumber) {
        throw new OrderDomainError(
          "CONCURRENCY_CONFLICT",
          "Order number was not persisted.",
          { retryable: true },
        );
      }
      return { id: po.id, orderNumber: po.orderNumber };
    } catch (error) {
      lastError = error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw (
    lastError ??
    new OrderDomainError(
      "CONCURRENCY_CONFLICT",
      "Could not allocate a unique order number.",
      { retryable: true },
    )
  );
}
