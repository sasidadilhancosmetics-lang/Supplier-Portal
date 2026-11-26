import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import {
  DELIVERY_IDEMPOTENCY_TTL_MS,
  rejectDeliveryIdempotencyScope,
  rescheduleDeliveryIdempotencyScope,
  scheduleDeliveryIdempotencyScope,
  submitDeliveryIdempotencyScope,
  verifyDeliveryIdempotencyScope,
} from "./constants";
import { DeliveryDomainError } from "./errors";
import {
  canonicalRejectDeliveryPayload,
  canonicalRescheduleDeliveryPayload,
  canonicalScheduleDeliveryPayload,
  canonicalSubmitDeliveryPayload,
  canonicalVerifyDeliveryPayload,
} from "./schema";

export type SubmitDeliveryIdempotencyResult = {
  deliveryId: string;
  purchaseOrderId: string;
  status: "SUBMITTED";
};

export type ScheduleDeliveryIdempotencyResult = {
  deliveryId: string;
  purchaseOrderId: string;
  status: "SCHEDULED";
};

export type RescheduleDeliveryIdempotencyResult = {
  deliveryId: string;
  purchaseOrderId: string;
  supersededDeliveryId: string;
  status: "SCHEDULED";
};

export type VerifyDeliveryIdempotencyResult = {
  deliveryId: string;
  purchaseOrderId: string;
  status: "VERIFIED";
  grnId: string | null;
  hasDiscrepancy: boolean;
};

export type RejectDeliveryIdempotencyResult = {
  deliveryId: string;
  purchaseOrderId: string;
  status: "REJECTED";
};

type StoredResponse<TResult> = {
  status: "pending" | "complete";
  requestHash: string;
  result?: TResult;
};

export function hashSubmitDeliveryPayload(
  input: Parameters<typeof canonicalSubmitDeliveryPayload>[0],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalSubmitDeliveryPayload(input)))
    .digest("hex");
}

export function hashScheduleDeliveryPayload(
  input: Parameters<typeof canonicalScheduleDeliveryPayload>[0],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalScheduleDeliveryPayload(input)))
    .digest("hex");
}

export function hashRescheduleDeliveryPayload(
  input: Parameters<typeof canonicalRescheduleDeliveryPayload>[0],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRescheduleDeliveryPayload(input)))
    .digest("hex");
}

export function hashVerifyDeliveryPayload(
  input: Parameters<typeof canonicalVerifyDeliveryPayload>[0],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalVerifyDeliveryPayload(input)))
    .digest("hex");
}

export function hashRejectDeliveryPayload(
  input: Parameters<typeof canonicalRejectDeliveryPayload>[0],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRejectDeliveryPayload(input)))
    .digest("hex");
}

function parseStored<TResult>(
  json: Prisma.JsonValue | null,
  validateResult: (result: unknown) => result is TResult,
): StoredResponse<TResult> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "pending" && obj.status !== "complete") return null;
  if (typeof obj.requestHash !== "string") return null;
  if (obj.status === "complete") {
    if (!validateResult(obj.result)) return null;
  }
  return obj as unknown as StoredResponse<TResult>;
}

function isSubmitResult(result: unknown): result is SubmitDeliveryIdempotencyResult {
  return (
    !!result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as { deliveryId?: unknown }).deliveryId === "string" &&
    typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId ===
      "string" &&
    (result as { status?: unknown }).status === "SUBMITTED"
  );
}

function isScheduleResult(
  result: unknown,
): result is ScheduleDeliveryIdempotencyResult {
  return (
    !!result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as { deliveryId?: unknown }).deliveryId === "string" &&
    typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId ===
      "string" &&
    (result as { status?: unknown }).status === "SCHEDULED"
  );
}

function isRescheduleResult(
  result: unknown,
): result is RescheduleDeliveryIdempotencyResult {
  return (
    isScheduleResult(result) &&
    typeof (result as { supersededDeliveryId?: unknown }).supersededDeliveryId ===
      "string"
  );
}

function isVerifyResult(result: unknown): result is VerifyDeliveryIdempotencyResult {
  return (
    !!result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as { deliveryId?: unknown }).deliveryId === "string" &&
    typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId ===
      "string" &&
    (result as { status?: unknown }).status === "VERIFIED" &&
    typeof (result as { hasDiscrepancy?: unknown }).hasDiscrepancy === "boolean"
  );
}

function isRejectResult(result: unknown): result is RejectDeliveryIdempotencyResult {
  return (
    !!result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as { deliveryId?: unknown }).deliveryId === "string" &&
    typeof (result as { purchaseOrderId?: unknown }).purchaseOrderId ===
      "string" &&
    (result as { status?: unknown }).status === "REJECTED"
  );
}

async function claimIdempotency<TResult>(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    now: Date;
    parse: (json: Prisma.JsonValue | null) => StoredResponse<TResult> | null;
  },
): Promise<
  | { kind: "replay"; result: TResult }
  | { kind: "claim"; scope: string; key: string; requestHash: string }
> {
  const existing = await tx.idempotencyKey.findUnique({
    where: { scope_key: { scope: args.scope, key: args.key } },
  });
  if (existing) {
    const stored = args.parse(existing.responseJson);
    if (!stored) {
      throw new DeliveryDomainError(
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
        "Idempotency key has an unreadable stored response.",
      );
    }
    if (stored.requestHash !== args.requestHash) {
      throw new DeliveryDomainError(
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
        "Idempotency key was reused with a different payload.",
      );
    }
    if (stored.status === "complete" && stored.result) {
      return { kind: "replay", result: stored.result };
    }
    throw new DeliveryDomainError(
      "IDEMPOTENCY_IN_PROGRESS",
      "A matching delivery request is still in progress. Retry shortly.",
      { retryable: true },
    );
  }

  try {
    await tx.idempotencyKey.create({
      data: {
        scope: args.scope,
        key: args.key,
        responseJson: {
          status: "pending",
          requestHash: args.requestHash,
        },
        expiresAt: new Date(args.now.getTime() + DELIVERY_IDEMPOTENCY_TTL_MS),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DeliveryDomainError(
        "IDEMPOTENCY_IN_PROGRESS",
        "A matching delivery request is still in progress. Retry shortly.",
        { retryable: true },
      );
    }
    throw error;
  }

  return {
    kind: "claim",
    scope: args.scope,
    key: args.key,
    requestHash: args.requestHash,
  };
}

async function completeIdempotency<TResult>(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: TResult;
    now: Date;
  },
) {
  await tx.idempotencyKey.update({
    where: { scope_key: { scope: args.scope, key: args.key } },
    data: {
      responseJson: {
        status: "complete",
        requestHash: args.requestHash,
        result: args.result as unknown as Prisma.InputJsonValue,
      },
      expiresAt: new Date(args.now.getTime() + DELIVERY_IDEMPOTENCY_TTL_MS),
    },
  });
}

export async function claimSubmitIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  return claimIdempotency(tx, {
    scope: submitDeliveryIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now,
    parse: (json) => parseStored(json, isSubmitResult),
  });
}

export async function completeSubmitIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: SubmitDeliveryIdempotencyResult;
    now: Date;
  },
) {
  return completeIdempotency(tx, args);
}

export async function claimVerifyIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  return claimIdempotency(tx, {
    scope: verifyDeliveryIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now,
    parse: (json) => parseStored(json, isVerifyResult),
  });
}

export async function completeVerifyIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: VerifyDeliveryIdempotencyResult;
    now: Date;
  },
) {
  return completeIdempotency(tx, args);
}

export async function claimRejectIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  return claimIdempotency(tx, {
    scope: rejectDeliveryIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now,
    parse: (json) => parseStored(json, isRejectResult),
  });
}

export async function completeRejectIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: RejectDeliveryIdempotencyResult;
    now: Date;
  },
) {
  return completeIdempotency(tx, args);
}

export async function claimScheduleIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  return claimIdempotency(tx, {
    scope: scheduleDeliveryIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now,
    parse: (json) => parseStored(json, isScheduleResult),
  });
}

export async function completeScheduleIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: ScheduleDeliveryIdempotencyResult;
    now: Date;
  },
) {
  return completeIdempotency(tx, args);
}

export async function claimRescheduleIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  return claimIdempotency(tx, {
    scope: rescheduleDeliveryIdempotencyScope(args.actorUserId),
    key: args.key,
    requestHash: args.requestHash,
    now: args.now,
    parse: (json) => parseStored(json, isRescheduleResult),
  });
}

export async function completeRescheduleIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: RescheduleDeliveryIdempotencyResult;
    now: Date;
  },
) {
  return completeIdempotency(tx, args);
}
