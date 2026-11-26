import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import {
  ORDER_IDEMPOTENCY_TTL_MS,
  allocateIdempotencyScope,
  cancelIdempotencyScope,
  confirmIdempotencyScope,
} from "./constants";
import { OrderDomainError } from "./errors";
import {
  canonicalAllocatePayload,
  canonicalCancelPayload,
  canonicalConfirmPayload,
} from "./schema";

export type AllocateIdempotencyResult = {
  purchaseOrderId: string;
  orderNumber: string;
};

export type ConfirmIdempotencyResult = {
  purchaseOrderId: string;
  orderNumber: string;
  status: "CONFIRMED";
  confirmedAt: string;
};

export type CancelIdempotencyResult = {
  purchaseOrderId: string;
  orderNumber: string;
  status: "CANCELLED" | "PARTIALLY_CANCELLED";
  cancelledAt: string;
  cancelReason: string;
  releasedQuantityTotal: string;
};

type StoredResponse<TResult> = {
  status: "pending" | "complete";
  requestHash: string;
  result?: TResult;
};

export function hashAllocatePayload(
  input: Parameters<typeof canonicalAllocatePayload>[0],
): string {
  const canonical = canonicalAllocatePayload(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function hashConfirmPayload(
  input: Parameters<typeof canonicalConfirmPayload>[0],
): string {
  const canonical = canonicalConfirmPayload(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function hashCancelPayload(
  input: Parameters<typeof canonicalCancelPayload>[0],
): string {
  const canonical = canonicalCancelPayload(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function parseStoredAllocate(
  json: Prisma.JsonValue | null,
): StoredResponse<AllocateIdempotencyResult> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "pending" && obj.status !== "complete") return null;
  if (typeof obj.requestHash !== "string") return null;
  if (obj.status === "complete") {
    const result = obj.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId !==
        "string" ||
      typeof (result as { orderNumber?: unknown }).orderNumber !== "string"
    ) {
      return null;
    }
  }
  return obj as unknown as StoredResponse<AllocateIdempotencyResult>;
}

function parseStoredConfirm(
  json: Prisma.JsonValue | null,
): StoredResponse<ConfirmIdempotencyResult> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "pending" && obj.status !== "complete") return null;
  if (typeof obj.requestHash !== "string") return null;
  if (obj.status === "complete") {
    const result = obj.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId !==
        "string" ||
      typeof (result as { orderNumber?: unknown }).orderNumber !== "string" ||
      (result as { status?: unknown }).status !== "CONFIRMED" ||
      typeof (result as { confirmedAt?: unknown }).confirmedAt !== "string"
    ) {
      return null;
    }
  }
  return obj as unknown as StoredResponse<ConfirmIdempotencyResult>;
}

function parseStoredCancel(
  json: Prisma.JsonValue | null,
): StoredResponse<CancelIdempotencyResult> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "pending" && obj.status !== "complete") return null;
  if (typeof obj.requestHash !== "string") return null;
  if (obj.status === "complete") {
    const result = obj.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId !==
        "string" ||
      typeof (result as { orderNumber?: unknown }).orderNumber !== "string" ||
      ((result as { status?: unknown }).status !== "CANCELLED" &&
        (result as { status?: unknown }).status !== "PARTIALLY_CANCELLED") ||
      typeof (result as { cancelledAt?: unknown }).cancelledAt !== "string" ||
      typeof (result as { cancelReason?: unknown }).cancelReason !== "string" ||
      typeof (result as { releasedQuantityTotal?: unknown })
        .releasedQuantityTotal !== "string"
    ) {
      return null;
    }
  }
  return obj as unknown as StoredResponse<CancelIdempotencyResult>;
}

export type AllocateIdempotencyClaim =
  | { kind: "acquired"; scope: string; key: string; requestHash: string }
  | { kind: "replay"; result: AllocateIdempotencyResult };

export type ConfirmIdempotencyClaim =
  | { kind: "acquired"; scope: string; key: string; requestHash: string }
  | { kind: "replay"; result: ConfirmIdempotencyResult };

export type CancelIdempotencyClaim =
  | { kind: "acquired"; scope: string; key: string; requestHash: string }
  | { kind: "replay"; result: CancelIdempotencyResult };

/** @deprecated Use AllocateIdempotencyClaim */
export type IdempotencyClaim = AllocateIdempotencyClaim;

async function claimScopedIdempotency<TResult>(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    now: Date;
    parse: (
      json: Prisma.JsonValue | null,
    ) => StoredResponse<TResult> | null;
    inProgressMessage: string;
  },
): Promise<
  | { kind: "acquired"; scope: string; key: string; requestHash: string }
  | { kind: "replay"; result: TResult }
> {
  const expiresAt = new Date(args.now.getTime() + ORDER_IDEMPOTENCY_TTL_MS);
  const pending = { expiresAt, responseJson: { status: "pending", requestHash: args.requestHash } };
  const inserted = await tx.idempotencyKey.createMany({
    data: { scope: args.scope, key: args.key, ...pending },
    skipDuplicates: true,
  });
  if (inserted.count) {
    return {
      kind: "acquired",
      scope: args.scope,
      key: args.key,
      requestHash: args.requestHash,
    };
  }

  const existing = await tx.idempotencyKey.findUnique({
    where: { scope_key: { scope: args.scope, key: args.key } },
  });
  if (!existing) {
    throw new OrderDomainError(
      "CONCURRENCY_CONFLICT",
      "Idempotency claim raced; retry.",
      { retryable: true },
    );
  }

  const expired =
    existing.expiresAt != null &&
    existing.expiresAt.getTime() <= args.now.getTime();

  if (expired) {
    const renewed = await tx.idempotencyKey.updateMany({
      where: { id: existing.id, expiresAt: { lte: args.now } },
      data: pending,
    });
    if (!renewed.count) {
      throw new OrderDomainError("CONCURRENCY_CONFLICT", "Idempotency renewal raced; retry.", { retryable: true });
    }
    return {
      kind: "acquired",
      scope: args.scope,
      key: args.key,
      requestHash: args.requestHash,
    };
  }

  const stored = args.parse(existing.responseJson);
  if (!stored) {
    throw new OrderDomainError(
      "CONCURRENCY_CONFLICT",
      "Idempotency record is unreadable; retry.",
      { retryable: true },
    );
  }

  if (stored.requestHash !== args.requestHash) {
    throw new OrderDomainError(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "This idempotency key was already used with a different payload.",
    );
  }

  if (stored.status === "complete" && stored.result) {
    return { kind: "replay", result: stored.result };
  }

  throw new OrderDomainError("IDEMPOTENCY_IN_PROGRESS", args.inProgressMessage, {
    retryable: true,
  });
}

export async function claimAllocateIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now?: Date;
  },
): Promise<AllocateIdempotencyClaim> {
  return claimScopedIdempotency(tx, {
    scope: allocateIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now ?? new Date(),
    parse: parseStoredAllocate,
    inProgressMessage: "An identical allocate request is still in progress.",
  });
}

export async function completeAllocateIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: AllocateIdempotencyResult;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  await tx.idempotencyKey.update({
    where: { scope_key: { scope: args.scope, key: args.key } },
    data: {
      expiresAt: new Date(now.getTime() + ORDER_IDEMPOTENCY_TTL_MS),
      responseJson: {
        status: "complete",
        requestHash: args.requestHash,
        result: args.result,
      },
    },
  });
}

export async function claimConfirmIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now?: Date;
  },
): Promise<ConfirmIdempotencyClaim> {
  return claimScopedIdempotency(tx, {
    scope: confirmIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now ?? new Date(),
    parse: parseStoredConfirm,
    inProgressMessage: "An identical confirm request is still in progress.",
  });
}

export async function completeConfirmIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: ConfirmIdempotencyResult;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  await tx.idempotencyKey.update({
    where: { scope_key: { scope: args.scope, key: args.key } },
    data: {
      expiresAt: new Date(now.getTime() + ORDER_IDEMPOTENCY_TTL_MS),
      responseJson: {
        status: "complete",
        requestHash: args.requestHash,
        result: args.result,
      },
    },
  });
}

export async function claimCancelIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now?: Date;
  },
): Promise<CancelIdempotencyClaim> {
  return claimScopedIdempotency(tx, {
    scope: cancelIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now ?? new Date(),
    parse: parseStoredCancel,
    inProgressMessage: "An identical cancel request is still in progress.",
  });
}

export async function completeCancelIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: CancelIdempotencyResult;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  await tx.idempotencyKey.update({
    where: { scope_key: { scope: args.scope, key: args.key } },
    data: {
      expiresAt: new Date(now.getTime() + ORDER_IDEMPOTENCY_TTL_MS),
      responseJson: {
        status: "complete",
        requestHash: args.requestHash,
        result: args.result,
      },
    },
  });
}
