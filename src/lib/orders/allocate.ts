import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { parseCalendarDateInput } from "@/lib/dates";
import { readAvailabilitySplits } from "@/lib/requests/availability-splits";
import { loadDateAllocations } from "./availability-split-capacity";

import { writeAuditLog } from "@/lib/audit";
import { requireStaffPermission } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { createUserNotification } from "@/lib/notifications";

import {
  remainingOffer,
  splitAgainstPlan,
} from "./allocation-math";
import { ALLOCATE_MAX_TRANSIENT_ATTEMPTS } from "./constants";
import { loadRequirementCoverage } from "./coverage";
import { OrderDomainError, isOrderDomainError } from "./errors";
import {
  claimAllocateIdempotency,
  completeAllocateIdempotency,
  hashAllocatePayload,
  type AllocateIdempotencyResult,
} from "./idempotency";
import {
  lockAvailabilityOffersForUpdate,
  lockRequirementItemsForUpdate,
} from "./locks";
import { createPurchaseOrderWithUniqueNumber } from "./order-number";
import {
  isPricingDomainError,
} from "@/lib/pricing/errors";
import { requireAgreedPriceForAllocate } from "@/lib/pricing/quotes";

import {
  allocateInputSchema,
  previewAllocationSchema,
  type AllocateInput,
  type PreviewAllocationInput,
} from "./schema";

function isTransientPrisma(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // P2034: transaction conflict / write conflict; P2028: transaction API error
  return error.code === "P2034" || error.code === "P2028";
}

async function expireOfferInTx(
  tx: Prisma.TransactionClient,
  offerId: string,
  now: Date,
) {
  const offer = await tx.availabilityOffer.findUnique({ where: { id: offerId } });
  if (
    !offer ||
    offer.status !== "SUBMITTED" ||
    !offer.reserveExpiresAt ||
    offer.reserveExpiresAt.getTime() > now.getTime()
  ) {
    return offer;
  }
  const claimed = await tx.availabilityOffer.updateMany({
    where: {
      id: offer.id,
      status: "SUBMITTED",
      reserveExpiresAt: { lte: now },
    },
    data: { status: "EXPIRED", version: { increment: 1 } },
  });
  if (claimed.count === 1) {
    await tx.availabilityChange.create({
      data: {
        id: createId(),
        availabilityOfferId: offer.id,
        changeType: "EXPIRED",
        statusBefore: "SUBMITTED",
        statusAfter: "EXPIRED",
        quantityDeclaredBefore: offer.quantityDeclared,
        quantityDeclaredAfter: offer.quantityDeclared,
      },
    });
  }
  return tx.availabilityOffer.findUnique({ where: { id: offerId } });
}

type LoadedOffer = {
  id: string;
  supplierId: string;
  status: import("@/generated/prisma/client").AvailabilityOfferStatus;
  quantityDeclared: Prisma.Decimal;
  quantityOrderedActive: Prisma.Decimal;
  availableDate: Date | null;
  availableSplits: Prisma.JsonValue | null;
  reservedAt: Date | null;
  reserveExpiresAt: Date | null;
  version: number;
  currencyCode: string | null;
  unitPrice: Prisma.Decimal | null;
  requestItem: {
    id: string;
    companyId: string;
    requirementItemId: string | null;
    productId: string;
    quantityRequested: Prisma.Decimal;
  };
};

async function loadOffersForSupplier(
  tx: Prisma.TransactionClient,
  supplierId: string,
  companyId: string,
  offerIds: string[],
): Promise<LoadedOffer[]> {
  const offers = await tx.availabilityOffer.findMany({
    where: {
      id: { in: offerIds },
      supplierId,
      requestItem: { companyId },
    },
    include: {
      requestItem: {
        select: {
          id: true,
          companyId: true,
          requirementItemId: true,
          productId: true,
          quantityRequested: true,
        },
      },
    },
  });
  if (offers.length !== offerIds.length) {
    throw new OrderDomainError(
      "NOT_FOUND",
      "One or more availability offers were not found for this supplier.",
    );
  }
  return offers;
}

export type PreviewLine = {
  availabilityOfferId: string;
  productId: string;
  requirementItemId: string | null;
  quantityRequested: string;
  remainingOffer: string;
  remainingPlan: string;
  projectedInPlan: string;
  projectedAbovePlan: string;
  offerStatus: string;
  reserveExpiresAt: Date | null;
  availableDate: Date | null;
};

function distinctOfferIds(lines: AllocateInput["lines"]) {
  const selections = new Set(lines.map((line) => JSON.stringify([line.availabilityOfferId, line.splitDate])));
  if (selections.size !== lines.length) {
    throw new OrderDomainError("VALIDATION", "Select each offer date only once.");
  }
  return [...new Set(lines.map((line) => line.availabilityOfferId))].sort();
}

async function dateCapacity(
  tx: Prisma.TransactionClient,
  offer: LoadedOffer,
  splitDate: string | undefined,
  remaining: Prisma.Decimal,
) {
  if (!splitDate && offer.availableSplits == null) {
    return { remaining, expectedDate: offer.availableDate };
  }
  const split = readAvailabilitySplits(offer.availableSplits).find((row) => row.date === splitDate);
  if (!split) {
    throw new OrderDomainError("VALIDATION", "Select a currently offered date. Refresh the availability if it changed.");
  }
  const allocated = await loadDateAllocations(tx, offer.id, offer.requestItem.companyId, offer.supplierId);
  return {
    expectedDate: parseCalendarDateInput(split.date),
    remaining: Prisma.Decimal.max(0, Prisma.Decimal.min(remaining,
      new Prisma.Decimal(split.quantity).minus(allocated.get(split.date) ?? 0))),
  };
}

export async function previewAllocation(raw: PreviewAllocationInput) {
  const user = await requireStaffPermission("ALLOCATE_ORDER");
  const parsed = previewAllocationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid allocation preview.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]),
      ),
    });
  }

  const offerIds = distinctOfferIds(parsed.data.lines);
  const offers = await loadOffersForSupplier(
    prisma,
    parsed.data.supplierId,
    user.companyId,
    offerIds,
  );
  const now = new Date();
  const byId = new Map(offers.map((o) => [o.id, o]));

  const requirementIds = offers
    .map((o) => o.requestItem.requirementItemId)
    .filter((id): id is string => Boolean(id));

  // Preview is read-only — no FOR UPDATE; coverage may race (UI only).
  const coverage = await loadRequirementCoverage(prisma, requirementIds);
  const runningPlan = new Map<string, Prisma.Decimal>();
  for (const [id, c] of coverage) {
    runningPlan.set(id, c.remainingPlan);
  }

  const lines: PreviewLine[] = [];
  const used = new Map<string, Prisma.Decimal>();
  let requiresAboveRequestAck = false;
  for (const line of parsed.data.lines) {
    const offer = byId.get(line.availabilityOfferId)!;
    const previouslySelected = used.get(offer.id) ?? new Prisma.Decimal(0);
    const aggregate = remainingOffer({
      status: offer.status,
      quantityDeclared: offer.quantityDeclared,
      quantityOrderedActive: offer.quantityOrderedActive,
      reserveExpiresAt: offer.reserveExpiresAt,
      now,
    }).minus(previouslySelected);
    const date = await dateCapacity(prisma, offer, line.splitDate, aggregate);
    const selected = previouslySelected.plus(line.quantity);
    used.set(offer.id, selected);
    if (offer.quantityOrderedActive.plus(selected).greaterThan(offer.requestItem.quantityRequested)) requiresAboveRequestAck = true;
    const reqId = offer.requestItem.requirementItemId;
    let remPlan = new Prisma.Decimal(0);
    if (reqId) {
      remPlan = runningPlan.get(reqId) ?? new Prisma.Decimal(0);
    }
    const split = splitAgainstPlan(line.quantity, remPlan);
    if (reqId) runningPlan.set(reqId, split.nextRemaining);

    lines.push({
      availabilityOfferId: offer.id,
      productId: offer.requestItem.productId,
      requirementItemId: reqId,
      quantityRequested: line.quantity,
      remainingOffer: date.remaining.toString(),
      remainingPlan: remPlan.toString(),
      projectedInPlan: split.inPlan.toString(),
      projectedAbovePlan: split.abovePlan.toString(),
      offerStatus: offer.status,
      reserveExpiresAt: offer.reserveExpiresAt,
      availableDate: date.expectedDate,
    });
  }

  const abovePlanTotal = lines.reduce(
    (acc, l) => acc.plus(l.projectedAbovePlan),
    new Prisma.Decimal(0),
  );

  return {
    supplierId: parsed.data.supplierId,
    lines,
    abovePlanTotal: abovePlanTotal.toString(),
    requiresAbovePlanAck: abovePlanTotal.greaterThan(0) || requiresAboveRequestAck,
  };
}

async function allocateOnce(
  user: ProvisionedAppUser,
  input: AllocateInput,
): Promise<AllocateIdempotencyResult> {
  const requestHash = hashAllocatePayload(input);
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      const claim = await claimAllocateIdempotency(tx, {
        actorUserId: user.id,
        key: input.idempotencyKey,
        requestHash,
        now,
      });
      if (claim.kind === "replay") {
        return claim.result;
      }

      const offerIds = distinctOfferIds(input.lines);

      const offers = await loadOffersForSupplier(
        tx,
        input.supplierId,
        user.companyId,
        offerIds,
      );

      const requirementItemIds: string[] = [];
      for (const offer of offers) {
        if (!offer.requestItem.requirementItemId) {
          throw new OrderDomainError(
            "MISSING_REQUIREMENT_LINK",
            "An offer is not linked to a requirement item and cannot be allocated.",
          );
        }
        requirementItemIds.push(offer.requestItem.requirementItemId);
      }

      // Requirement-level serialization, then offer locks (deterministic order).
      await lockRequirementItemsForUpdate(tx, requirementItemIds);
      await lockAvailabilityOffersForUpdate(tx, offerIds);

      // Expire + re-read after locks.
      for (const id of offerIds) {
        await expireOfferInTx(tx, id, now);
      }
      const lockedOffers = await loadOffersForSupplier(
        tx,
        input.supplierId,
        user.companyId,
        offerIds,
      );
      const lockedById = new Map(lockedOffers.map((o) => [o.id, o]));

      const coverage = await loadRequirementCoverage(tx, requirementItemIds);
      const runningPlan = new Map<string, Prisma.Decimal>();
      for (const [id, c] of coverage) {
        runningPlan.set(id, c.remainingPlan);
      }

      type PreparedLine = {
        offer: LoadedOffer;
        quantity: Prisma.Decimal;
        inPlan: Prisma.Decimal;
        abovePlan: Prisma.Decimal;
        netOrderedBefore: Prisma.Decimal;
        remainingPlanBefore: Prisma.Decimal;
        expectedDate: Date | null;
        splitDate?: string;
      };

      const prepared: PreparedLine[] = [];
      let abovePlanTotal = new Prisma.Decimal(0);
      let requiresAboveRequestAck = false;
      const used = new Map<string, Prisma.Decimal>();

      for (const line of input.lines) {
        const offer = lockedById.get(line.availabilityOfferId)!;
        const qty = new Prisma.Decimal(line.quantity);
        const previouslySelected = used.get(offer.id) ?? new Prisma.Decimal(0);
        const remOffer = remainingOffer({
          status: offer.status,
          quantityDeclared: offer.quantityDeclared,
          quantityOrderedActive: offer.quantityOrderedActive,
          reserveExpiresAt: offer.reserveExpiresAt,
          now,
        }).minus(previouslySelected);
        if (remOffer.lessThanOrEqualTo(0)) {
          throw new OrderDomainError(
            "OFFER_NOT_ALLOCATABLE",
            "Offer is not allocatable (status or reserve).",
            { fieldErrors: { [offer.id]: "Not allocatable" } },
          );
        }
        const date = await dateCapacity(tx, offer, line.splitDate, remOffer);
        if (qty.greaterThan(date.remaining)) {
          throw new OrderDomainError(
            "INSUFFICIENT_OFFER",
            "Requested quantity exceeds the remaining quantity for the offer or selected date.",
            { fieldErrors: { [offer.id]: "Exceeds remaining offer" } },
          );
        }
        const selected = previouslySelected.plus(qty);
        used.set(offer.id, selected);
        if (offer.quantityOrderedActive.plus(selected).greaterThan(offer.requestItem.quantityRequested)) {
          requiresAboveRequestAck = true;
        }

        const reqId = offer.requestItem.requirementItemId!;
        const cov = coverage.get(reqId)!;
        const remPlan = runningPlan.get(reqId) ?? new Prisma.Decimal(0);
        const split = splitAgainstPlan(qty, remPlan);
        runningPlan.set(reqId, split.nextRemaining);
        abovePlanTotal = abovePlanTotal.plus(split.abovePlan);

        prepared.push({
          offer,
          quantity: qty,
          inPlan: split.inPlan,
          abovePlan: split.abovePlan,
          netOrderedBefore: cov.netOrdered,
          remainingPlanBefore: remPlan,
          expectedDate: date.expectedDate,
          splitDate: line.splitDate,
        });
      }

      if (abovePlanTotal.greaterThan(0) || requiresAboveRequestAck) {
        if (!input.abovePlan?.acknowledged || !input.abovePlan.reason) {
          throw new OrderDomainError(
            "ABOVE_PLAN_REQUIRED",
            "Allocation exceeds the supplier request or remaining plan. Approve the extra quantity with a reason.",
          );
        }
      }

      const poId = createId();
      // Currency comes from agreed prices when present; fall back to offer.
      const currencyCode =
        prepared.find((p) => p.offer.currencyCode)?.offer.currencyCode ?? "LKR";

      const po = await createPurchaseOrderWithUniqueNumber(tx, {
        id: poId,
        companyId: user.companyId,
        supplierId: input.supplierId,
        status: "SENT",
        currencyCode,
        requiresScheduleApproval: prepared.some((line) => Boolean(line.splitDate)),
      });

      const auditLines = [];
      const applied = new Map<string, { quantity: Prisma.Decimal; version: number }>();

      for (const row of prepared) {
        let agreed;
        try {
          agreed = await requireAgreedPriceForAllocate(tx, {
            availabilityOfferId: row.offer.id,
            companyId: user.companyId,
            supplierId: input.supplierId,
          });
        } catch (error) {
          if (isPricingDomainError(error)) {
            throw new OrderDomainError("VALIDATION", error.message, {
              fieldErrors: { [row.offer.id]: error.message },
            });
          }
          throw error;
        }

        const itemId = createId();
        await tx.orderItem.create({
          data: {
            id: itemId,
            purchaseOrderId: po.id,
            companyId: user.companyId,
            supplierId: input.supplierId,
            availabilityOfferId: row.offer.id,
            productId: row.offer.requestItem.productId,
            status: "ACTIVE",
            quantityOrdered: row.quantity,
            quantityCancelled: new Prisma.Decimal(0),
            quantityVerifiedReceived: new Prisma.Decimal(0),
            unitPrice: agreed.unitPrice,
            priceQuoteId: agreed.priceQuoteId,
            priceAgreementStatusAtOrder: agreed.priceAgreementStatusAtOrder,
            // Calendar day copied as stored (UTC midnight); do not shift.
            originalExpectedDeliveryAt: row.expectedDate,
          },
        });

        const previous = applied.get(row.offer.id) ?? { quantity: row.offer.quantityOrderedActive, version: row.offer.version };
        const nextActive = previous.quantity.plus(row.quantity);
        const bumped = await tx.availabilityOffer.updateMany({
          where: {
            id: row.offer.id,
            status: "SUBMITTED",
            reserveExpiresAt: { gt: now },
            quantityOrderedActive: previous.quantity,
            version: previous.version,
          },
          data: {
            quantityOrderedActive: nextActive,
            version: { increment: 1 },
          },
        });
        if (bumped.count !== 1) {
          throw new OrderDomainError(
            "CONCURRENCY_CONFLICT",
            "Offer changed during allocation; retry.",
            { retryable: true },
          );
        }
        applied.set(row.offer.id, { quantity: nextActive, version: previous.version + 1 });

        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: row.offer.id,
            changeType: "ORDER_ALLOCATION_INCREASED",
            statusBefore: row.offer.status,
            statusAfter: row.offer.status,
            quantityDeclaredBefore: row.offer.quantityDeclared,
            quantityDeclaredAfter: row.offer.quantityDeclared,
            quantityOrderedActiveBefore: previous.quantity,
            quantityOrderedActiveAfter: nextActive,
            actorUserId: user.id,
          },
        });

        // Never move reserve timestamps.
        auditLines.push({
          orderItemId: itemId,
          availabilityOfferId: row.offer.id,
          requirementItemId: row.offer.requestItem.requirementItemId,
          quantity: row.quantity.toString(),
          inPlan: row.inPlan.toString(),
          abovePlan: row.abovePlan.toString(),
          netOrderedBefore: row.netOrderedBefore.toString(),
          remainingPlanBefore: row.remainingPlanBefore.toString(),
          reservedAt: row.offer.reservedAt?.toISOString() ?? null,
          reserveExpiresAt: row.offer.reserveExpiresAt?.toISOString() ?? null,
          availableDate: row.expectedDate?.toISOString() ?? null,
        });
      }

      await writeAuditLog({
        tx,
        actorUserId: user.id,
        entityType: "PurchaseOrder",
        entityId: po.id,
        action: "CREATE",
        afterJson: {
          event: "PURCHASE_ORDER_ALLOCATED",
          purchaseOrderId: po.id,
          orderNumber: po.orderNumber,
          supplierId: input.supplierId,
          abovePlanQuantity: abovePlanTotal.toString(),
          aboveRequestApproved: requiresAboveRequestAck,
          abovePlanReason: input.abovePlan?.reason ?? null,
          actorUserId: user.id,
          authorizedAt: now.toISOString(),
          idempotencyKey: input.idempotencyKey,
          offerIds,
          lines: auditLines,
        },
      });

      const supplierUsers = await tx.user.findMany({
        where: {
          supplierId: input.supplierId,
          companyId: user.companyId,
          role: "SUPPLIER",
          isActive: true,
        },
        select: { id: true },
      });
      for (const su of supplierUsers) {
        await createUserNotification({
          tx,
          userId: su.id,
          title: "New purchase order",
          body: `Purchase order ${po.orderNumber} was created from your availability.`,
          entityType: "PurchaseOrder",
          entityId: po.id,
        });
      }

      const result = {
        purchaseOrderId: po.id,
        orderNumber: po.orderNumber,
      };
      await completeAllocateIdempotency(tx, {
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.requestHash,
        result,
        now,
      });

      return result;
    },
    {
      // Neon interactive transaction; keep under serverless limits.
      maxWait: 10_000,
      timeout: 20_000,
    },
  );
}

/** Core allocate entry used by the public API and Neon integration tests. */
export async function allocatePurchaseOrderForUser(
  user: ProvisionedAppUser,
  raw: AllocateInput,
): Promise<AllocateIdempotencyResult> {
  const parsed = allocateInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid allocation request.", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]),
      ),
    });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= ALLOCATE_MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      return await allocateOnce(user, parsed.data);
    } catch (error) {
      lastError = error;
      const retryable =
        (isOrderDomainError(error) && error.retryable) ||
        isTransientPrisma(error);
      if (!retryable || attempt === ALLOCATE_MAX_TRANSIENT_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function allocatePurchaseOrder(
  raw: AllocateInput,
): Promise<AllocateIdempotencyResult> {
  const user = await requireStaffPermission("ALLOCATE_ORDER");
  return allocatePurchaseOrderForUser(user, raw);
}
