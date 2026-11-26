import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { confirmRequirementInTransaction } from "@/lib/requirements/mutations";
import { RequirementDomainError } from "@/lib/requirements/errors";

import { lockCompanyCatalogue } from "./catalogue-lock";
import { OsfImportDomainError } from "./errors";
import { confirmOsfImportSchema } from "./schema";
import { isUnresolvedMapping } from "./status";

const CONFIRM_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type ConfirmOsfImportResult = {
  importId: string;
  status: "CONFIRMED";
  confirmedAt: string;
  confirmedRequirementIds: string[];
  brandCount: number;
  itemCount: number;
  totalQuantityPlanned: string;
  already: boolean;
  replay: boolean;
};

type StoredConfirmResponse = {
  status: "pending" | "complete";
  requestHash: string;
  result?: ConfirmOsfImportResult;
};

export function osfImportConfirmIdempotencyScope(actorUserId: string): string {
  return `osf.import.confirm:${actorUserId}`;
}

export function hashConfirmOsfImportRequest(args: {
  importId: string;
  importVersion: number;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ importId: args.importId, importVersion: args.importVersion }))
    .digest("hex");
}

function parseStoredConfirm(
  json: Prisma.JsonValue | null,
): StoredConfirmResponse | null {
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
      typeof (result as { importId?: unknown }).importId !== "string" ||
      (result as { status?: unknown }).status !== "CONFIRMED"
    ) {
      return null;
    }
  }
  return obj as unknown as StoredConfirmResponse;
}

/**
 * Read-side idempotency resolution. Must run outside an interactive txn that
 * may have aborted on P2002 (Neon/Postgres aborts the whole txn on unique
 * violation inside interactive transactions).
 */
async function resolveConfirmIdempotencyOutsideTxn(args: {
  actorUserId: string;
  key: string;
  requestHash: string;
  now: Date;
}): Promise<
  | { kind: "proceed" }
  | { kind: "replay"; result: ConfirmOsfImportResult }
> {
  const scope = osfImportConfirmIdempotencyScope(args.actorUserId);
  const existing = await prisma.idempotencyKey.findUnique({
    where: { scope_key: { scope, key: args.key } },
  });
  if (!existing) return { kind: "proceed" };

  const expired =
    existing.expiresAt != null &&
    existing.expiresAt.getTime() <= args.now.getTime();
  if (expired) {
    await prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => undefined);
    return { kind: "proceed" };
  }

  const stored = parseStoredConfirm(existing.responseJson);
  if (!stored) {
    throw new OsfImportDomainError(
      "VERSION_CONFLICT",
      "Idempotency record is unreadable. Refresh and try again.",
    );
  }
  if (stored.requestHash !== args.requestHash) {
    throw new OsfImportDomainError(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "This idempotency key was already used with a different confirmation request.",
    );
  }
  if (stored.status === "complete" && stored.result) {
    return { kind: "replay", result: stored.result };
  }
  throw new OsfImportDomainError(
    "IDEMPOTENCY_IN_PROGRESS",
    "An identical confirm request is still in progress. Retry shortly.",
  );
}

async function acquireConfirmIdempotencyInTxn(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
): Promise<{ scope: string; key: string; requestHash: string }> {
  const scope = osfImportConfirmIdempotencyScope(args.actorUserId);
  const expiresAt = new Date(args.now.getTime() + CONFIRM_IDEMPOTENCY_TTL_MS);
  try {
    await tx.idempotencyKey.create({
      data: {
        scope,
        key: args.key,
        expiresAt,
        responseJson: {
          status: "pending",
          requestHash: args.requestHash,
        },
      },
    });
    return { scope, key: args.key, requestHash: args.requestHash };
  } catch (error) {
    // Do not query again in this txn — P2002 aborts the interactive PG txn.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new OsfImportDomainError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical confirm request is still in progress. Retry shortly.",
      );
    }
    throw error;
  }
}

async function completeConfirmIdempotency(
  tx: Prisma.TransactionClient,
  args: {
    scope: string;
    key: string;
    requestHash: string;
    result: ConfirmOsfImportResult;
    now: Date;
  },
) {
  await tx.idempotencyKey.update({
    where: { scope_key: { scope: args.scope, key: args.key } },
    data: {
      expiresAt: new Date(args.now.getTime() + CONFIRM_IDEMPOTENCY_TTL_MS),
      responseJson: {
        status: "complete",
        requestHash: args.requestHash,
        result: args.result,
      },
    },
  });
}

function mapRequirementError(error: unknown): never {
  if (error instanceof RequirementDomainError) {
    throw new OsfImportDomainError(
      error.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE",
      error.message,
    );
  }
  throw error;
}

/**
 * Atomically confirm every eligible DRAFT brand requirement on an OSF import.
 * Does not create SupplierRequest or PurchaseOrder rows.
 */
export async function confirmOsfImport(raw: unknown): Promise<ConfirmOsfImportResult> {
  const user = await requireStaffPermission("CONFIRM_REQUIREMENT");
  const parsed = confirmOsfImportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid confirmation request.",
    );
  }
  const input = parsed.data;
  const requestHash = hashConfirmOsfImportRequest({
    importId: input.importId,
    importVersion: input.importVersion,
  });
  const prior = await resolveConfirmIdempotencyOutsideTxn({
    actorUserId: user.id,
    key: input.idempotencyKey,
    requestHash,
    now: new Date(),
  });
  if (prior.kind === "replay") {
    return { ...prior.result, replay: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!await lockCompanyCatalogue(tx, user.companyId, "confirm-import")) {
        throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
      }
      const now = new Date();
      const claim = await acquireConfirmIdempotencyInTxn(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });

      const osfImport = await tx.osfImport.findFirst({
        where: { id: input.importId, companyId: user.companyId },
        include: {
          lines: true,
          requirements: {
            include: {
              items: {
                select: {
                  id: true,
                  productId: true,
                  quantityPlanned: true,
                },
              },
              brand: { select: { id: true, companyId: true } },
            },
          },
        },
      });
      if (!osfImport) {
        throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
      }

      if (osfImport.status === "CONFIRMED") {
        const confirmedIds = osfImport.requirements
          .filter((r) => r.status === "CONFIRMED")
          .map((r) => r.id);
        const itemCount = osfImport.requirements.reduce(
          (n, r) => n + r.items.length,
          0,
        );
        const totalQty = osfImport.requirements.reduce(
          (sum, r) =>
            sum +
            r.items.reduce((s, i) => s + Number(i.quantityPlanned), 0),
          0,
        );
        const result: ConfirmOsfImportResult = {
          importId: osfImport.id,
          status: "CONFIRMED",
          confirmedAt: (osfImport.confirmedAt ?? now).toISOString(),
          confirmedRequirementIds: confirmedIds,
          brandCount: confirmedIds.length,
          itemCount,
          totalQuantityPlanned: String(totalQty),
          already: true,
          replay: false,
        };
        await completeConfirmIdempotency(tx, {
          scope: claim.scope,
          key: claim.key,
          requestHash: claim.requestHash,
          result,
          now,
        });
        return result;
      }

      if (osfImport.status !== "READY_TO_CONFIRM") {
        throw new OsfImportDomainError(
          "NOT_READY",
          "Import is not ready to confirm. Resolve remaining review issues first.",
        );
      }

      if (osfImport.version !== input.importVersion) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "Import was updated elsewhere. Refresh and try again.",
        );
      }

      // Line preflight: unresolved non-excluded blocks; zero/excluded allowed.
      for (const line of osfImport.lines) {
        if (
          line.mappingStatus === "EXCLUDED" ||
          line.mappingStatus === "REJECTED_ZERO_QTY" ||
          line.mappingStatus === "REJECTED_INVALID_QTY"
        ) {
          continue;
        }
        if (isUnresolvedMapping(line.mappingStatus)) {
          throw new OsfImportDomainError(
            "NOT_READY",
            `Unresolved line ${line.sku} must be mapped or excluded before confirm.`,
          );
        }
        if (line.mappingStatus !== "MATCHED_SKU") {
          throw new OsfImportDomainError(
            "NOT_READY",
            `Line ${line.sku} is not ready to confirm.`,
          );
        }
        if (
          !line.productId ||
          !line.brandId ||
          !line.requirementId ||
          !line.requirementItemId
        ) {
          throw new OsfImportDomainError(
            "INVALID_STATE",
            `Matched line ${line.sku} is missing product/brand/requirement links.`,
          );
        }
        if (Number(line.quantityPlanned) <= 0) {
          throw new OsfImportDomainError(
            "VALIDATION",
            `Matched line ${line.sku} must have a positive planned quantity.`,
          );
        }
      }

      const draftReqs = osfImport.requirements.filter((r) => r.status === "DRAFT");
      if (draftReqs.length < 1) {
        throw new OsfImportDomainError(
          "NOT_READY",
          "No draft brand requirements to confirm.",
        );
      }

      for (const req of draftReqs) {
        if (!req.brandId || req.brand?.companyId !== user.companyId) {
          throw new OsfImportDomainError(
            "INVALID_BRAND",
            "Requirement brand is invalid for this company.",
          );
        }
        if (req.items.length < 1) {
          throw new OsfImportDomainError(
            "INVALID_STATE",
            "Every brand requirement must include at least one item.",
          );
        }
      }

      const claimedImport = await tx.osfImport.updateMany({
        where: {
          id: osfImport.id,
          companyId: user.companyId,
          status: "READY_TO_CONFIRM",
          version: input.importVersion,
        },
        data: {
          status: "CONFIRMED",
          confirmedAt: now,
          confirmedById: user.id,
          version: { increment: 1 },
        },
      });
      if (claimedImport.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "Import was updated elsewhere. Refresh and try again.",
        );
      }

      const confirmedRequirementIds: string[] = [];
      let itemCount = 0;
      let totalQuantityPlanned = 0;

      for (const req of draftReqs) {
        try {
          const confirmed = await confirmRequirementInTransaction(tx, {
            requirementId: req.id,
            companyId: user.companyId,
            actorUserId: user.id,
            now,
          });
          confirmedRequirementIds.push(confirmed.id);
          itemCount += req.items.length;
          totalQuantityPlanned += req.items.reduce(
            (s, i) => s + Number(i.quantityPlanned),
            0,
          );
        } catch (error) {
          mapRequirementError(error);
        }
      }

      // Also include any already-confirmed sibling reqs (should be none in happy path).
      for (const req of osfImport.requirements) {
        if (
          req.status === "CONFIRMED" &&
          !confirmedRequirementIds.includes(req.id)
        ) {
          confirmedRequirementIds.push(req.id);
        }
      }

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "OsfImport",
        entityId: osfImport.id,
        action: "STATUS_CHANGE",
        beforeJson: { status: "READY_TO_CONFIRM", version: input.importVersion },
        afterJson: {
          event: "OSF_IMPORT_CONFIRMED",
          status: "CONFIRMED",
          confirmedRequirementIds,
          brandCount: confirmedRequirementIds.length,
          itemCount,
          totalQuantityPlanned: String(totalQuantityPlanned),
          suppliersNotified: false,
        },
      });

      const result: ConfirmOsfImportResult = {
        importId: osfImport.id,
        status: "CONFIRMED",
        confirmedAt: now.toISOString(),
        confirmedRequirementIds,
        brandCount: draftReqs.length,
        itemCount,
        totalQuantityPlanned: String(totalQuantityPlanned),
        already: false,
        replay: false,
      };

      await completeConfirmIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });

      return result;
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (isOsfImportDomainErrorLike(error)) throw error;
    if (error instanceof RequirementDomainError) {
      mapRequirementError(error);
    }
    throw error;
  }
}

function isOsfImportDomainErrorLike(
  error: unknown,
): error is OsfImportDomainError {
  return error instanceof OsfImportDomainError;
}
