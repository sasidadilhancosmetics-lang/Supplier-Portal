import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireStaffPermission } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import {
  ACTIVE_REQUEST_STATUSES,
  assertAcknowledgeOverQtyForRecipients,
  buildQuantityByItemId,
  distributeRequirementInTransaction,
  recipientsFromPlanned,
  type DistributeRecipient,
} from "@/lib/requests/distribute-core";
import { isRequestDomainError } from "@/lib/requests/errors";
import { filterMatchingSuppliers, type MatchableSupplier } from "@/lib/requests/matching";

import { OsfImportDomainError } from "./errors";
import {
  distributeOsfImportSchema,
  type DistributeOsfImportInput,
} from "./distribute-schema";

const CLAIM_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Phase F1 lock order and transaction boundaries
 * ---------------------------------------------
 * Per brand (separate interactive transaction; never one mega-txn for all brands):
 *   1. `Requirement` row `SELECT … FOR UPDATE` (company + requirement scoped)
 *   2. Read/claim `OsfImportDistribution` for (osfImportId, requirementId)
 *      - Terminal SUCCEEDED / SKIPPED_ALREADY_REQUESTED → return without resend
 *      - Active foreign IN_PROGRESS claim (unexpired, other token) → VERSION_CONFLICT
 *      - Else claim/reclaim → IN_PROGRESS with claimToken + claimExpiresAt
 *   3. Resolve matching ACTIVE suppliers + active SupplierRequest skip set
 *   4. Create SupplierRequest + RequestItem + in-DB notifications + requirement audit
 *      via `distributeRequirementInTransaction` (same txn)
 *   5. Complete ledger → SUCCEEDED or SKIPPED_ALREADY_REQUESTED (clears claim)
 *
 * On thrown errors inside the brand txn: entire brand txn rolls back (including claim).
 * A follow-up short txn then records FAILED (lastError, no claim) when safe.
 *
 * Wizard-level IdempotencyKey:
 *   - Resolve (replay / conflict / in-progress) OUTSIDE interactive txns (P2002-safe)
 *   - Acquire pending key in a short txn BEFORE the brand loop
 *   - Complete with aggregated outcomes AFTER the brand loop (+ OsfImport audit)
 *
 * External email/push side effects are not sent inside these txns; only DB
 * Notification rows are written with request creates (existing portal pattern).
 */

export type BrandDistributeOutcome = {
  requirementId: string;
  brandId: string;
  brandName: string;
  status:
    | "SUCCEEDED"
    | "SKIPPED_ALREADY_REQUESTED"
    | "FAILED"
    | "ALREADY_SUCCEEDED";
  requestIds: string[];
  alreadyRequestedSupplierIds: string[];
  error?: string;
};

export type DistributeOsfImportResult = {
  importId: string;
  brands: BrandDistributeOutcome[];
  replay: boolean;
};

type StoredDistributeResponse = {
  status: "pending" | "complete";
  requestHash: string;
  result?: DistributeOsfImportResult;
};

export function osfImportDistributeIdempotencyScope(actorUserId: string): string {
  return `osf.import.distribute:${actorUserId}`;
}

export function hashDistributeOsfImportRequest(
  input: DistributeOsfImportInput,
): string {
  const canonical = {
    importId: input.importId,
    responseDeadline: input.responseDeadline ?? null,
    acknowledgeOverQty: input.acknowledgeOverQty,
    retryFailedOnly: input.retryFailedOnly,
    brands: [...input.brands]
      .map((b) => ({
        requirementId: b.requirementId,
        mode: b.mode,
        supplierIds: [...b.supplierIds].sort(),
        quantityOverrides: (b.quantityOverrides ?? [])
          .map((o) => ({
            requirementItemId: o.requirementItemId,
            quantityRequested: o.quantityRequested,
          }))
          .sort((a, c) =>
            a.requirementItemId.localeCompare(c.requirementItemId),
          ),
        supplierRecipients: (b.supplierRecipients ?? [])
          .map((r) => ({
            supplierId: r.supplierId,
            items: [...r.items]
              .map((i) => ({
                requirementItemId: i.requirementItemId,
                quantityRequested: i.quantityRequested,
              }))
              .sort((a, c) =>
                a.requirementItemId.localeCompare(c.requirementItemId),
              ),
          }))
          .sort((a, c) => a.supplierId.localeCompare(c.supplierId)),
      }))
      .sort((a, c) => a.requirementId.localeCompare(c.requirementId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parseStored(
  json: Prisma.JsonValue | null,
): StoredDistributeResponse | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "pending" && obj.status !== "complete") return null;
  if (typeof obj.requestHash !== "string") return null;
  return obj as unknown as StoredDistributeResponse;
}

async function resolveIdempotencyOutsideTxn(args: {
  actorUserId: string;
  key: string;
  requestHash: string;
  now: Date;
}): Promise<
  | { kind: "proceed" }
  | { kind: "replay"; result: DistributeOsfImportResult }
> {
  const scope = osfImportDistributeIdempotencyScope(args.actorUserId);
  const existing = await prisma.idempotencyKey.findUnique({
    where: { scope_key: { scope, key: args.key } },
  });
  if (!existing) return { kind: "proceed" };
  const expired =
    existing.expiresAt != null &&
    existing.expiresAt.getTime() <= args.now.getTime();
  if (expired) {
    await prisma.idempotencyKey
      .delete({ where: { id: existing.id } })
      .catch(() => undefined);
    return { kind: "proceed" };
  }
  const stored = parseStored(existing.responseJson);
  if (!stored) {
    throw new OsfImportDomainError(
      "VERSION_CONFLICT",
      "Idempotency record is unreadable. Refresh and try again.",
    );
  }
  if (stored.requestHash !== args.requestHash) {
    throw new OsfImportDomainError(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "This idempotency key was already used with a different distribution request.",
    );
  }
  if (stored.status === "complete" && stored.result) {
    return { kind: "replay", result: { ...stored.result, replay: true } };
  }
  throw new OsfImportDomainError(
    "IDEMPOTENCY_IN_PROGRESS",
    "An identical distribution request is still in progress. Retry shortly.",
  );
}

async function acquireIdempotencyInTxn(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
) {
  const scope = osfImportDistributeIdempotencyScope(args.actorUserId);
  try {
    await tx.idempotencyKey.create({
      data: {
        scope,
        key: args.key,
        expiresAt: new Date(args.now.getTime() + IDEMPOTENCY_TTL_MS),
        responseJson: {
          status: "pending",
          requestHash: args.requestHash,
        },
      },
    });
    return { scope, key: args.key, requestHash: args.requestHash };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new OsfImportDomainError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical distribution request is still in progress. Retry shortly.",
      );
    }
    throw error;
  }
}

/**
 * Wizard read model for confirmed OSF import distribution.
 */
export async function getOsfImportDistributeModel(importId: string) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");

  const osfImport = await prisma.osfImport.findFirst({
    where: { id: importId, companyId: user.companyId },
    include: {
      requirements: {
        where: { status: "CONFIRMED" },
        include: {
          brand: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              quantityPlanned: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  priorityStatus: true,
                },
              },
            },
          },
        },
        orderBy: { title: "asc" },
      },
      distributions: true,
      lines: {
        select: {
          id: true,
          requirementItemId: true,
          brandId: true,
        },
      },
      requestSuggestions: {
        select: {
          id: true,
          osfImportLineId: true,
          lineKey: true,
          cosmoSupplierId: true,
          cosmoSupplierCode: true,
          cosmoSupplierName: true,
          suggestedRequestQty: true,
          supplierId: true,
          mappingStatus: true,
          warningFlags: true,
        },
      },
    },
  });
  if (!osfImport) {
    throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
  }
  if (osfImport.status !== "CONFIRMED") {
    throw new OsfImportDomainError(
      "NOT_READY",
      "Only confirmed imports can be distributed.",
    );
  }

  const suppliers = await prisma.supplier.findMany({
    where: { companyId: user.companyId },
    select: {
      id: true,
      name: true,
      status: true,
      supportsAllBrands: true,
      brands: { select: { brandId: true } },
    },
    orderBy: { name: "asc" },
  });
  const matchable: MatchableSupplier[] = suppliers.map((s) => ({
    id: s.id,
    status: s.status,
    supportsAllBrands: s.supportsAllBrands,
    brandIds: s.brands.map((b) => b.brandId),
  }));

  const ledgerByReq = new Map(
    osfImport.distributions.map((d) => [d.requirementId, d]),
  );
  const lineById = new Map(osfImport.lines.map((l) => [l.id, l]));

  const brands = [];
  for (const req of osfImport.requirements) {
    const matchingIds = new Set(
      filterMatchingSuppliers(matchable, req.brandId).map((s) => s.id),
    );
    const existing = await prisma.supplierRequest.findMany({
      where: {
        companyId: user.companyId,
        requirementId: req.id,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
      },
      select: { supplierId: true, status: true },
    });
    const activeBySupplier = new Map(
      existing.map((row) => [row.supplierId, row.status]),
    );
    const ledger = ledgerByReq.get(req.id);
    const itemIds = new Set(req.items.map((i) => i.id));

    const suggestions = osfImport.requestSuggestions
      .map((s) => {
        const line = lineById.get(s.osfImportLineId);
        if (!line?.requirementItemId || !itemIds.has(line.requirementItemId)) {
          return null;
        }
        return {
          suggestionId: s.id,
          requirementItemId: line.requirementItemId,
          lineKey: s.lineKey,
          cosmoSupplierId: s.cosmoSupplierId,
          cosmoSupplierCode: s.cosmoSupplierCode,
          cosmoSupplierName: s.cosmoSupplierName,
          suggestedRequestQty: s.suggestedRequestQty.toString(),
          supplierId: s.supplierId,
          mappingStatus: s.mappingStatus,
          overLineQty: Boolean(
            s.warningFlags &&
              typeof s.warningFlags === "object" &&
              !Array.isArray(s.warningFlags) &&
              (s.warningFlags as { overLineQty?: unknown }).overLineQty ===
                true,
          ),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s != null);

    const prefillSupplierIds = [
      ...new Set(
        suggestions
          .filter(
            (s) =>
              s.mappingStatus === "MATCHED_SUPPLIER" &&
              s.supplierId != null &&
              matchingIds.has(s.supplierId) &&
              !activeBySupplier.has(s.supplierId),
          )
          .map((s) => s.supplierId!),
      ),
    ];

    brands.push({
      requirementId: req.id,
      brandId: req.brand.id,
      brandName: req.brand.name,
      title: req.title,
      ledgerStatus: ledger?.status ?? null,
      lastError: ledger?.lastError ?? null,
      hasSuggestions: suggestions.length > 0,
      prefillSupplierIds,
      suggestions,
      items: req.items.map((item) => ({
        id: item.id,
        quantityPlanned: item.quantityPlanned.toString(),
        product: item.product,
      })),
      suppliers: suppliers
        .filter((s) => matchingIds.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          supportsAllBrands: s.supportsAllBrands,
          alreadyRequested: activeBySupplier.has(s.id),
          existingStatus: activeBySupplier.get(s.id) ?? null,
        })),
    });
  }

  return {
    importId: osfImport.id,
    status: osfImport.status,
    confirmedAt: osfImport.confirmedAt?.toISOString() ?? null,
    brands,
  };
}

async function lockRequirement(
  tx: Prisma.TransactionClient,
  args: { requirementId: string; companyId: string },
) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text AS status
    FROM "Requirement"
    WHERE id = ${args.requirementId} AND "companyId" = ${args.companyId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new OsfImportDomainError("NOT_FOUND", "Requirement not found.");
  }
  if (row.status !== "CONFIRMED") {
    throw new OsfImportDomainError(
      "NOT_READY",
      "Only confirmed requirements can be distributed.",
    );
  }
  return row;
}

async function recordBrandFailure(args: {
  actor: ProvisionedAppUser;
  importId: string;
  requirementId: string;
  claimToken: string;
  message: string;
  now: Date;
}) {
  await prisma.$transaction(async (tx) => {
    await lockRequirement(tx, {
      requirementId: args.requirementId,
      companyId: args.actor.companyId,
    }).catch(() => undefined);

    const ledger = await tx.osfImportDistribution.findUnique({
      where: {
        osfImportId_requirementId: {
          osfImportId: args.importId,
          requirementId: args.requirementId,
        },
      },
    });

    if (
      ledger?.status === "SUCCEEDED" ||
      ledger?.status === "SKIPPED_ALREADY_REQUESTED"
    ) {
      return;
    }

    if (
      ledger?.status === "IN_PROGRESS" &&
      ledger.claimExpiresAt &&
      ledger.claimExpiresAt.getTime() > args.now.getTime() &&
      ledger.claimToken &&
      ledger.claimToken !== args.claimToken
    ) {
      return;
    }

    const lastError = args.message.slice(0, 500);
    if (!ledger) {
      await tx.osfImportDistribution.create({
        data: {
          companyId: args.actor.companyId,
          osfImportId: args.importId,
          requirementId: args.requirementId,
          status: "FAILED",
          lastError,
          attemptCount: 1,
        },
      });
      return;
    }

    await tx.osfImportDistribution.update({
      where: { id: ledger.id },
      data: {
        status: "FAILED",
        claimToken: null,
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError,
        completedAt: null,
        version: { increment: 1 },
      },
    });
  });
}

/**
 * Per-brand distribution with OsfImportDistribution ledger.
 */
async function distributeOneBrand(args: {
  actor: ProvisionedAppUser;
  importId: string;
  brandInput: DistributeOsfImportInput["brands"][number];
  responseDeadline: Date | null;
  acknowledgeOverQty: boolean;
  claimToken: string;
  now: Date;
}): Promise<BrandDistributeOutcome> {
  const { actor, brandInput } = args;

  return prisma.$transaction(async (tx) => {
    await lockRequirement(tx, {
      requirementId: brandInput.requirementId,
      companyId: actor.companyId,
    });

    const requirement = await tx.requirement.findFirst({
      where: {
        id: brandInput.requirementId,
        companyId: actor.companyId,
        osfImportId: args.importId,
      },
      include: {
        brand: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantityPlanned: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                priorityStatus: true,
              },
            },
          },
        },
      },
    });
    if (!requirement) {
      throw new OsfImportDomainError("NOT_FOUND", "Requirement not found.");
    }

    let ledger = await tx.osfImportDistribution.findUnique({
      where: {
        osfImportId_requirementId: {
          osfImportId: args.importId,
          requirementId: brandInput.requirementId,
        },
      },
    });

    if (ledger?.status === "SUCCEEDED") {
      return {
        requirementId: requirement.id,
        brandId: requirement.brand.id,
        brandName: requirement.brand.name,
        status: "ALREADY_SUCCEEDED" as const,
        requestIds: Array.isArray(ledger.supplierRequestIds)
          ? (ledger.supplierRequestIds as string[])
          : [],
        alreadyRequestedSupplierIds: [],
      };
    }
    if (ledger?.status === "SKIPPED_ALREADY_REQUESTED") {
      return {
        requirementId: requirement.id,
        brandId: requirement.brand.id,
        brandName: requirement.brand.name,
        status: "SKIPPED_ALREADY_REQUESTED" as const,
        requestIds: [],
        alreadyRequestedSupplierIds: Array.isArray(
          ledger.alreadyRequestedSupplierIds,
        )
          ? (ledger.alreadyRequestedSupplierIds as string[])
          : [],
      };
    }

    if (
      ledger?.status === "IN_PROGRESS" &&
      ledger.claimExpiresAt &&
      ledger.claimExpiresAt.getTime() > args.now.getTime() &&
      ledger.claimToken !== args.claimToken
    ) {
      throw new OsfImportDomainError(
        "VERSION_CONFLICT",
        `Distribution for ${requirement.brand.name} is already in progress.`,
      );
    }

    const claimExpiresAt = new Date(args.now.getTime() + CLAIM_TTL_MS);
    if (!ledger) {
      ledger = await tx.osfImportDistribution.create({
        data: {
          companyId: actor.companyId,
          osfImportId: args.importId,
          requirementId: brandInput.requirementId,
          status: "IN_PROGRESS",
          claimToken: args.claimToken,
          claimedById: actor.id,
          claimedAt: args.now,
          claimExpiresAt,
          attemptCount: 1,
        },
      });
    } else {
      const claimed = await tx.osfImportDistribution.updateMany({
        where: {
          id: ledger.id,
          OR: [
            { status: "FAILED" },
            {
              status: "IN_PROGRESS",
              claimExpiresAt: { lte: args.now },
            },
            {
              status: "IN_PROGRESS",
              claimToken: args.claimToken,
            },
          ],
        },
        data: {
          status: "IN_PROGRESS",
          claimToken: args.claimToken,
          claimedById: actor.id,
          claimedAt: args.now,
          claimExpiresAt,
          attemptCount: { increment: 1 },
          lastError: null,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          `Could not claim distribution for ${requirement.brand.name}. Retry shortly.`,
        );
      }
    }

    const suppliers = await tx.supplier.findMany({
      where: { companyId: actor.companyId },
      select: {
        id: true,
        name: true,
        status: true,
        supportsAllBrands: true,
        brands: { select: { brandId: true } },
      },
    });
    const matchable: MatchableSupplier[] = suppliers.map((s) => ({
      id: s.id,
      status: s.status,
      supportsAllBrands: s.supportsAllBrands,
      brandIds: s.brands.map((b) => b.brandId),
    }));
    const matchingIds = new Set(
      filterMatchingSuppliers(matchable, requirement.brandId).map((s) => s.id),
    );

    const existing = await tx.supplierRequest.findMany({
      where: {
        companyId: actor.companyId,
        requirementId: requirement.id,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
      },
      select: { supplierId: true },
    });
    const already = new Set(existing.map((e) => e.supplierId));

    const eligible = suppliers.filter(
      (s) =>
        matchingIds.has(s.id) && s.status === "ACTIVE" && !already.has(s.id),
    );

    const items = requirement.items.map((item) => ({
      id: item.id,
      quantityPlanned: item.quantityPlanned.toString(),
      product: item.product,
    }));
    const itemById = new Map(items.map((i) => [i.id, i]));

    const alreadyRequestedSupplierIds = suppliers
      .filter((s) => matchingIds.has(s.id) && already.has(s.id))
      .map((s) => s.id);

    let explicitRecipients: DistributeRecipient[];

    const rawSupplierRecipients = brandInput.supplierRecipients;
    if (rawSupplierRecipients != null) {
      // F2C path: explicit per-supplier items. Empty items = ignored supplier.
      const activePlans = rawSupplierRecipients.filter((r) => r.items.length > 0);
      if (activePlans.length === 0) {
        throw new OsfImportDomainError(
          "VALIDATION",
          "Select at least one supplier with request quantities (ignored suppliers are omitted).",
        );
      }
      const eligibleById = new Map(eligible.map((s) => [s.id, s]));
      explicitRecipients = [];
      for (const plan of activePlans) {
        const supplier = eligibleById.get(plan.supplierId);
        if (!supplier) {
          throw new OsfImportDomainError(
            "VALIDATION",
            "One or more selected suppliers are not eligible.",
          );
        }
        explicitRecipients.push({
          id: supplier.id,
          name: supplier.name,
          items: plan.items.map((line) => {
            const item = itemById.get(line.requirementItemId);
            if (!item) {
              throw new OsfImportDomainError(
                "VALIDATION",
                `Unknown requirement item: ${line.requirementItemId}`,
              );
            }
            return {
              requirementItemId: line.requirementItemId,
              productId: item.product.id,
              quantityRequested: new Prisma.Decimal(line.quantityRequested),
            };
          }),
        });
      }
      try {
        assertAcknowledgeOverQtyForRecipients({
          items,
          recipients: explicitRecipients,
          acknowledgeOverQty: args.acknowledgeOverQty,
        });
      } catch (error) {
        if (isRequestDomainError(error)) {
          throw new OsfImportDomainError("VALIDATION", error.message);
        }
        throw error;
      }
    } else {
      // F1 path: ALL_MATCHING / SELECTED + shared quantityOverrides.
      let recipients = eligible;
      if (brandInput.mode === "SELECTED") {
        const selected = new Set(brandInput.supplierIds);
        if (selected.size === 0) {
          throw new OsfImportDomainError(
            "VALIDATION",
            "Select at least one supplier.",
          );
        }
        recipients = eligible.filter((s) => selected.has(s.id));
        const invalid = [...selected].filter(
          (id) => !eligible.some((s) => s.id === id),
        );
        if (invalid.length > 0) {
          throw new OsfImportDomainError(
            "VALIDATION",
            "One or more selected suppliers are not eligible.",
          );
        }
      }

      if (recipients.length === 0) {
        if (alreadyRequestedSupplierIds.length === 0) {
          throw new OsfImportDomainError(
            "INVALID_STATE",
            `No eligible suppliers for ${requirement.brand.name}.`,
          );
        }
        await tx.osfImportDistribution.update({
          where: { id: ledger.id },
          data: {
            status: "SKIPPED_ALREADY_REQUESTED",
            claimToken: null,
            claimedById: null,
            claimedAt: null,
            claimExpiresAt: null,
            alreadyRequestedSupplierIds,
            supplierRequestIds: [],
            completedAt: args.now,
            lastError: null,
            version: { increment: 1 },
          },
        });
        return {
          requirementId: requirement.id,
          brandId: requirement.brand.id,
          brandName: requirement.brand.name,
          status: "SKIPPED_ALREADY_REQUESTED" as const,
          requestIds: [],
          alreadyRequestedSupplierIds,
        };
      }

      let quantityByItemId: Map<string, Prisma.Decimal>;
      try {
        quantityByItemId = buildQuantityByItemId(
          items,
          brandInput.quantityOverrides,
          args.acknowledgeOverQty,
        );
      } catch (error) {
        if (isRequestDomainError(error)) {
          throw new OsfImportDomainError("VALIDATION", error.message);
        }
        throw error;
      }
      explicitRecipients = recipientsFromPlanned({
        recipients,
        items,
        quantityByItemId,
      });
    }

    if (explicitRecipients.length === 0) {
      if (alreadyRequestedSupplierIds.length === 0) {
        throw new OsfImportDomainError(
          "INVALID_STATE",
          `No eligible suppliers for ${requirement.brand.name}.`,
        );
      }
      await tx.osfImportDistribution.update({
        where: { id: ledger.id },
        data: {
          status: "SKIPPED_ALREADY_REQUESTED",
          claimToken: null,
          claimedById: null,
          claimedAt: null,
          claimExpiresAt: null,
          alreadyRequestedSupplierIds,
          supplierRequestIds: [],
          completedAt: args.now,
          lastError: null,
          version: { increment: 1 },
        },
      });
      return {
        requirementId: requirement.id,
        brandId: requirement.brand.id,
        brandName: requirement.brand.name,
        status: "SKIPPED_ALREADY_REQUESTED" as const,
        requestIds: [],
        alreadyRequestedSupplierIds,
      };
    }

    const distributed = await distributeRequirementInTransaction(tx, {
      actor,
      requirementId: requirement.id,
      brandId: requirement.brand.id,
      brandName: requirement.brand.name,
      mode: brandInput.mode,
      items,
      recipients: explicitRecipients,
      responseDeadline: args.responseDeadline,
      now: args.now,
    });

    await tx.osfImportDistribution.update({
      where: { id: ledger.id },
      data: {
        status: "SUCCEEDED",
        claimToken: null,
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
        supplierRequestIds: distributed.requestIds,
        alreadyRequestedSupplierIds: distributed.skippedSupplierIds,
        completedAt: args.now,
        lastError: null,
        version: { increment: 1 },
      },
    });

    return {
      requirementId: requirement.id,
      brandId: requirement.brand.id,
      brandName: requirement.brand.name,
      status: "SUCCEEDED" as const,
      requestIds: distributed.requestIds,
      alreadyRequestedSupplierIds: distributed.skippedSupplierIds,
    };
  });
}

function failureMessage(error: unknown): string {
  if (isRequestDomainError(error) || error instanceof OsfImportDomainError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Distribution failed.";
}

/**
 * Orchestrate per-brand availability-request distribution for a confirmed OSF import.
 * Does not create PurchaseOrders.
 */
export async function distributeOsfImport(
  raw: unknown,
): Promise<DistributeOsfImportResult> {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const parsed = distributeOsfImportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid distribution request.",
    );
  }
  const input = parsed.data;
  const requestHash = hashDistributeOsfImportRequest(input);
  const now = new Date();

  const prior = await resolveIdempotencyOutsideTxn({
    actorUserId: user.id,
    key: input.idempotencyKey,
    requestHash,
    now,
  });
  if (prior.kind === "replay") {
    return prior.result;
  }

  const osfImport = await prisma.osfImport.findFirst({
    where: { id: input.importId, companyId: user.companyId },
    select: { id: true, status: true },
  });
  if (!osfImport) {
    throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
  }
  if (osfImport.status !== "CONFIRMED") {
    throw new OsfImportDomainError(
      "NOT_READY",
      "Only confirmed imports can be distributed.",
    );
  }

  let brandsToProcess = input.brands;
  if (input.retryFailedOnly) {
    const ledgers = await prisma.osfImportDistribution.findMany({
      where: {
        osfImportId: input.importId,
        companyId: user.companyId,
        requirementId: { in: input.brands.map((b) => b.requirementId) },
      },
    });
    const byReq = new Map(ledgers.map((l) => [l.requirementId, l]));
    brandsToProcess = input.brands.filter((b) => {
      const ledger = byReq.get(b.requirementId);
      return !ledger || ledger.status === "FAILED";
    });
    if (brandsToProcess.length === 0) {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "No failed brands to retry.",
      );
    }
  }

  const claim = await prisma.$transaction((tx) =>
    acquireIdempotencyInTxn(tx, {
      actorUserId: user.id,
      key: input.idempotencyKey,
      requestHash,
      now,
    }),
  );

  const claimToken = randomBytes(16).toString("hex");
  const deadline = input.responseDeadline
    ? new Date(input.responseDeadline)
    : null;

  const outcomes: BrandDistributeOutcome[] = [];
  for (const brand of brandsToProcess) {
    try {
      const outcome = await distributeOneBrand({
        actor: user,
        importId: input.importId,
        brandInput: brand,
        responseDeadline: deadline,
        acknowledgeOverQty: input.acknowledgeOverQty,
        claimToken,
        now,
      });
      outcomes.push(outcome);
    } catch (error) {
      const message = failureMessage(error);
      if (
        !(error instanceof OsfImportDomainError) ||
        error.code !== "VERSION_CONFLICT"
      ) {
        await recordBrandFailure({
          actor: user,
          importId: input.importId,
          requirementId: brand.requirementId,
          claimToken,
          message,
          now,
        }).catch(() => undefined);
      }
      const req = await prisma.requirement.findFirst({
        where: { id: brand.requirementId, companyId: user.companyId },
        include: { brand: { select: { id: true, name: true } } },
      });
      outcomes.push({
        requirementId: brand.requirementId,
        brandId: req?.brand.id ?? "",
        brandName: req?.brand.name ?? "Unknown",
        status: "FAILED",
        requestIds: [],
        alreadyRequestedSupplierIds: [],
        error: message,
      });
    }
  }

  // Brands omitted by retryFailedOnly: surface prior SUCCEEDED/SKIPPED for UI.
  if (input.retryFailedOnly) {
    const processed = new Set(outcomes.map((o) => o.requirementId));
    for (const brand of input.brands) {
      if (processed.has(brand.requirementId)) continue;
      const ledger = await prisma.osfImportDistribution.findUnique({
        where: {
          osfImportId_requirementId: {
            osfImportId: input.importId,
            requirementId: brand.requirementId,
          },
        },
      });
      const req = await prisma.requirement.findFirst({
        where: { id: brand.requirementId, companyId: user.companyId },
        include: { brand: { select: { id: true, name: true } } },
      });
      if (!req) continue;
      if (ledger?.status === "SUCCEEDED") {
        outcomes.push({
          requirementId: req.id,
          brandId: req.brand.id,
          brandName: req.brand.name,
          status: "ALREADY_SUCCEEDED",
          requestIds: Array.isArray(ledger.supplierRequestIds)
            ? (ledger.supplierRequestIds as string[])
            : [],
          alreadyRequestedSupplierIds: [],
        });
      } else if (ledger?.status === "SKIPPED_ALREADY_REQUESTED") {
        outcomes.push({
          requirementId: req.id,
          brandId: req.brand.id,
          brandName: req.brand.name,
          status: "SKIPPED_ALREADY_REQUESTED",
          requestIds: [],
          alreadyRequestedSupplierIds: Array.isArray(
            ledger.alreadyRequestedSupplierIds,
          )
            ? (ledger.alreadyRequestedSupplierIds as string[])
            : [],
        });
      }
    }
  }

  const result: DistributeOsfImportResult = {
    importId: input.importId,
    brands: outcomes,
    replay: false,
  };

  await prisma.$transaction(async (tx) => {
    await tx.idempotencyKey.update({
      where: { scope_key: { scope: claim.scope, key: claim.key } },
      data: {
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        responseJson: {
          status: "complete",
          requestHash: claim.requestHash,
          result,
        },
      },
    });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_DISTRIBUTED",
        brands: outcomes.map((o) => ({
          requirementId: o.requirementId,
          status: o.status,
          requestCount: o.requestIds.length,
        })),
        purchaseOrdersCreated: false,
      },
    });
  });

  return result;
}
