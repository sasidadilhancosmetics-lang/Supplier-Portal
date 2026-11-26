import { randomBytes } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { DeliveryDomainError } from "./errors";

function stamp(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function generateGrnNumberCandidate(now = new Date()): string {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `GRN-${stamp(now)}-${suffix}`;
}

export async function assignUniqueGrnNumber(
  tx: Prisma.TransactionClient,
  attempts = 5,
): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const grnNumber = generateGrnNumberCandidate();
    const clash = await tx.grn.findFirst({
      where: { grnNumber },
      select: { id: true },
    });
    if (!clash) return grnNumber;
    lastError = new DeliveryDomainError(
      "CONCURRENCY_CONFLICT",
      "Could not allocate a unique GRN number.",
      { retryable: true },
    );
  }
  throw (
    lastError ??
    new DeliveryDomainError(
      "CONCURRENCY_CONFLICT",
      "Could not allocate a unique GRN number.",
      { retryable: true },
    )
  );
}
