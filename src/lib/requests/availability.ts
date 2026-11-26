import "server-only";

import type {
  AvailabilityOfferStatus,
  Prisma,
} from "@/generated/prisma/client";
import { Prisma as PrismaNS } from "@/generated/prisma/client";

import {
  requireSupplier,
  requireSupplierOwnership,
} from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { loadSavedRequestPrices } from "@/lib/supplier/catalogue";
import { compatibleCataloguePrice } from "@/lib/supplier/catalogue-price-suggestion";
import { createUserNotification } from "@/lib/notifications";

import { parseCalendarDateInput } from "@/lib/dates";

import { isPricingDomainError } from "@/lib/pricing/errors";
import { recordSupplierAvailabilityPrice } from "@/lib/pricing/quotes";
import { isAgreedPriceStatus } from "@/lib/pricing/status";
import {
  buildCounterNegotiationDisplay,
  loadLastPurchasesForSupplierProducts,
  loadPreviousSupplierQuotedPrice,
  type CounterNegotiationDisplay,
} from "@/lib/pricing/supplier-negotiation-display";

import { RequestDomainError } from "./errors";
import { resolveReserveOnSubmit } from "./reserve";
import { readAvailabilitySplits, totalAvailability, type AvailabilitySplit } from "./availability-splits";
import {
  availabilityFieldErrorsFromZod,
  saveAvailabilityDraftSchema,
  submitAvailabilitySchema,
} from "./schema";

type LineInput = {
  requestItemId: string;
  quantityDeclared?: string | null;
  splits?: AvailabilitySplit[];
  unitPrice?: number | null;
  availableDate?: string;
  notAvailable: boolean;
  notes?: string;
  expectedVersion?: number;
};

function parseQty(line: LineInput): Prisma.Decimal | null {
  if (line.notAvailable) return new PrismaNS.Decimal(0);
  if (line.splits) return new PrismaNS.Decimal(totalAvailability(line.splits));
  if (line.quantityDeclared === null || line.quantityDeclared === undefined) {
    return null;
  }
  return new PrismaNS.Decimal(line.quantityDeclared);
}

function availabilityDate(line: LineInput) {
  return line.notAvailable ? null : parseDate(line.splits?.[0]?.date ?? line.availableDate);
}

function persistedSplits(line: LineInput) {
  return !line.notAvailable && line.splits ? line.splits : PrismaNS.DbNull;
}

function assertOfferVersion(count: number) {
  if (count !== 1) throw new RequestDomainError("STALE_VERSION", "This line was updated elsewhere. Reload and try again.");
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = parseCalendarDateInput(value);
  if (!d) {
    throw new RequestDomainError("VALIDATION", "Invalid delivery date.");
  }
  return d;
}

async function loadOwnedRequest(supplierRequestId: string, supplierId: string) {
  const request = await prisma.supplierRequest.findFirst({
    where: { id: supplierRequestId, supplierId },
    include: {
      brand: { select: { id: true, name: true } },
      items: {
        include: {
          availabilityOffer: {
            include: {
              priceAgreement: {
                include: {
                  currentQuote: {
                    select: {
                      id: true,
                      unitPrice: true,
                      currencyCode: true,
                      status: true,
                      kind: true,
                      createdAt: true,
                      availabilityOfferId: true,
                      supersedesQuote: {
                        select: {
                          id: true,
                          unitPrice: true,
                          currencyCode: true,
                          kind: true,
                          createdAt: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              priorityStatus: true,
              unitOfMeasure: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!request) {
    throw new RequestDomainError("NOT_FOUND", "Request not found.");
  }
  if (request.status === "CANCELLED" || request.status === "CLOSED") {
    throw new RequestDomainError(
      "INVALID_STATUS",
      "This request can no longer be answered.",
    );
  }
  return request;
}

async function notifyCompanyStaff(args: {
  tx: Prisma.TransactionClient;
  companyId: string;
  title: string;
  body: string;
  entityId: string;
}) {
  const staff = await args.tx.user.findMany({
    where: {
      companyId: args.companyId,
      role: { in: ["ADMIN", "STAFF"] },
      isActive: true,
    },
    select: { id: true },
    take: 50,
  });
  for (const row of staff) {
    await createUserNotification({
      tx: args.tx,
      userId: row.id,
      title: args.title,
      body: args.body,
      entityType: "SupplierRequest",
      entityId: args.entityId,
    });
  }
}

function deriveRequestStatus(
  offers: { status: AvailabilityOfferStatus }[],
  itemCount: number,
): "NEW" | "PARTIALLY_RESPONDED" | "RESPONDED" {
  const answered = offers.filter(
    (o) =>
      o.status === "SUBMITTED" ||
      o.status === "NOT_AVAILABLE" ||
      o.status === "EXPIRED" ||
      o.status === "CANCELLED",
  ).length;
  if (answered === 0) return "NEW";
  if (answered < itemCount) return "PARTIALLY_RESPONDED";
  return "RESPONDED";
}

/**
 * Upsert DRAFT offer rows. Never sets reserve timestamps.
 * Null qty + not NA = unanswered draft placeholder.
 */
export async function saveAvailabilityDraft(raw: unknown) {
  const parsed = saveAvailabilityDraftSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = Array.isArray((raw as { lines?: unknown })?.lines)
      ? ((raw as { lines: Array<{ requestItemId?: string }> }).lines)
      : [];
    throw new RequestDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid draft.",
      availabilityFieldErrorsFromZod(parsed.error, lines),
    );
  }

  const owner = await prisma.supplierRequest.findFirst({
    where: { id: parsed.data.supplierRequestId },
    select: { supplierId: true },
  });
  if (!owner) {
    throw new RequestDomainError("NOT_FOUND", "Request not found.");
  }
  const user = await requireSupplierOwnership(owner.supplierId);
  let request = await loadOwnedRequest(
    parsed.data.supplierRequestId,
    user.supplierId!,
  );

  for (const item of request.items) {
    if (item.availabilityOffer) {
      await expireOfferIfNeeded(item.availabilityOffer.id, user.supplierId!);
    }
  }
  request = await loadOwnedRequest(
    parsed.data.supplierRequestId,
    user.supplierId!,
  );

  const itemById = new Map(request.items.map((item) => [item.id, item]));

  await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.lines) {
      const item = itemById.get(line.requestItemId);
      if (!item || item.supplierId !== user.supplierId) {
        throw new RequestDomainError("NOT_FOUND", "Request line not found.");
      }

      const qty = parseQty(line);
      const availableDate = availabilityDate(line);
      const existing = item.availabilityOffer;

      if (
        existing &&
        line.expectedVersion !== undefined &&
        existing.version !== line.expectedVersion
      ) {
        throw new RequestDomainError(
          "STALE_VERSION",
          "This line was updated elsewhere. Reload and try again.",
        );
      }

      // Do not overwrite a live SUBMITTED reserve via draft save.
      if (existing && existing.status === "SUBMITTED") {
        continue;
      }

      const declared = qty ?? new PrismaNS.Decimal(0);
      const draftPrice =
        line.notAvailable || declared.lessThanOrEqualTo(0)
          ? null
          : line.unitPrice != null
            ? new PrismaNS.Decimal(line.unitPrice)
            : null;
      if (existing) {
        const saved = await tx.availabilityOffer.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            status: "DRAFT",
            quantityDeclared: new PrismaNS.Decimal(declared),
            unitPrice: draftPrice,
            currencyCode: draftPrice ? "LKR" : null,
            availableDate: line.notAvailable ? null : availableDate,
            availableSplits: persistedSplits(line),
            notes: line.notes ?? null,
            reservedAt: null,
            reserveExpiresAt: null,
            version: { increment: 1 },
          },
        });
        assertOfferVersion(saved.count);
        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: existing.id,
            actorUserId: user.id,
            changeType: "DRAFT_SAVED",
            quantityDeclaredBefore: existing.quantityDeclared,
            quantityDeclaredAfter: new PrismaNS.Decimal(declared),
            unitPriceBefore: existing.unitPrice,
            unitPriceAfter: draftPrice,
            statusBefore: existing.status,
            statusAfter: "DRAFT",
            availableDateBefore: existing.availableDate,
            availableDateAfter: line.notAvailable ? null : availableDate,
          },
        });
      } else {
        const offerId = createId();
        await tx.availabilityOffer.create({
          data: {
            id: offerId,
            requestItemId: item.id,
            supplierId: user.supplierId!,
            status: "DRAFT",
            quantityDeclared: new PrismaNS.Decimal(declared),
            unitPrice: draftPrice,
            currencyCode: draftPrice ? "LKR" : null,
            availableDate: line.notAvailable ? null : availableDate,
            availableSplits: persistedSplits(line),
            notes: line.notes ?? null,
            reservedAt: null,
            reserveExpiresAt: null,
          },
        });
        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: offerId,
            actorUserId: user.id,
            changeType: "DRAFT_SAVED",
            quantityDeclaredAfter: new PrismaNS.Decimal(declared),
            unitPriceAfter: draftPrice,
            statusAfter: "DRAFT",
            availableDateAfter: line.notAvailable ? null : availableDate,
          },
        });
      }
    }

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Supplier",
      entityId: user.supplierId!,
      action: "UPDATE",
      afterJson: {
        event: "AVAILABILITY_DRAFT_SAVED",
        supplierRequestId: request.id,
        lineCount: parsed.data.lines.length,
      },
    });
  });

  return { id: request.id };
}

/**
 * Submit lines: positive qty → SUBMITTED + reserve; zero/NA → NOT_AVAILABLE (no reserve).
 * Null unanswered lines are left unchanged (stay pending).
 * Concurrent protection via offer.version.
 */
export async function submitAvailability(raw: unknown) {
  const parsed = submitAvailabilitySchema.safeParse(raw);
  if (!parsed.success) {
    const lines = Array.isArray((raw as { lines?: unknown })?.lines)
      ? ((raw as { lines: Array<{ requestItemId?: string }> }).lines)
      : [];
    throw new RequestDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid submission.",
      availabilityFieldErrorsFromZod(parsed.error, lines),
    );
  }

  const owner = await prisma.supplierRequest.findFirst({
    where: { id: parsed.data.supplierRequestId },
    select: { supplierId: true },
  });
  if (!owner) {
    throw new RequestDomainError("NOT_FOUND", "Request not found.");
  }
  const user = await requireSupplierOwnership(owner.supplierId);
  let request = await loadOwnedRequest(
    parsed.data.supplierRequestId,
    user.supplierId!,
  );
  for (const item of request.items) {
    if (item.availabilityOffer) {
      await expireOfferIfNeeded(item.availabilityOffer.id, user.supplierId!);
    }
  }
  request = await loadOwnedRequest(
    parsed.data.supplierRequestId,
    user.supplierId!,
  );
  const itemById = new Map(request.items.map((item) => [item.id, item]));
  const now = new Date();

  let submittedCount = 0;
  let notifiedDecrease = false;

  await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.lines) {
      const item = itemById.get(line.requestItemId);
      if (!item || item.supplierId !== user.supplierId) {
        throw new RequestDomainError("NOT_FOUND", "Request line not found.");
      }

      const qty = parseQty(line);
      // Unanswered on submit: skip (remain pending).
      if (qty === null && !line.notAvailable) {
        continue;
      }

      if (qty === null) {
        continue;
      }
      const treatAsNa = line.notAvailable || qty.isZero();

      const availableDate = treatAsNa ? null : availabilityDate(line);
      if (!treatAsNa && !availableDate) {
        throw new RequestDomainError(
          "VALIDATION",
          `Delivery date required for ${item.product.name}.`,
          {
            [`${item.id}:date`]: "Enter a delivery date for this quantity.",
          },
        );
      }

      const existing = item.availabilityOffer;
      const priorAgreementEarly = existing?.priceAgreement ?? null;
      const agreementLockedEarly =
        priorAgreementEarly != null &&
        isAgreedPriceStatus(priorAgreementEarly.status);

      if (treatAsNa && line.unitPrice != null && !agreementLockedEarly) {
        throw new RequestDomainError(
          "VALIDATION",
          `Do not enter a unit price when marking ${item.product.name} not available.`,
          {
            [`${item.id}:unitPrice`]:
              "Clear unit price when marking not available.",
          },
        );
      }
      if (
        !treatAsNa &&
        !agreementLockedEarly &&
        (line.unitPrice == null || line.unitPrice <= 0)
      ) {
        throw new RequestDomainError(
          "VALIDATION",
          `Unit price (LKR) is required for ${item.product.name}.`,
          {
            [`${item.id}:unitPrice`]:
              "Enter a unit price in LKR greater than zero.",
          },
        );
      }

      if (
        existing &&
        line.expectedVersion !== undefined &&
        existing.version !== line.expectedVersion
      ) {
        throw new RequestDomainError(
          "STALE_VERSION",
          "This line was updated elsewhere. Reload and try again.",
        );
      }

      const nextStatus: AvailabilityOfferStatus = treatAsNa
        ? "NOT_AVAILABLE"
        : "SUBMITTED";

      const wasSubmitted = existing?.status === "SUBMITTED";
      const reserve = resolveReserveOnSubmit({
        nextStatus,
        quantity: qty.toNumber(),
        existing: existing
          ? {
              status: existing.status,
              reservedAt: existing.reservedAt,
              reserveExpiresAt: existing.reserveExpiresAt,
            }
          : null,
        now,
      });
      const reservedAt = reserve.reservedAt;
      const reserveExpiresAt = reserve.reserveExpiresAt;

      // New reserve must not include qty already committed to orders.
      const orderedActive = existing?.quantityOrderedActive ?? new PrismaNS.Decimal(0);
      if (nextStatus === "SUBMITTED" && qty.lessThan(orderedActive)) {
        throw new RequestDomainError(
          "VALIDATION",
          `Available quantity for ${item.product.name} cannot be below already ordered quantity (${orderedActive}).`,
        );
      }

      const warningBelowOrdered =
        nextStatus === "SUBMITTED" &&
        orderedActive.greaterThan(0) &&
        qty.lessThan(orderedActive);

      const priorAgreement = priorAgreementEarly;
      const agreementLocked = agreementLockedEarly;

      // Agreed prices are independent of availability submit — never overwrite.
      const nextUnitPrice =
        nextStatus === "SUBMITTED"
          ? agreementLocked && priorAgreement
            ? priorAgreement.unitPrice
            : line.unitPrice != null
              ? new PrismaNS.Decimal(line.unitPrice)
              : null
          : null;

      if (existing) {
        const beforeQty = existing.quantityDeclared;
        const saved = await tx.availabilityOffer.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            status: nextStatus,
            quantityDeclared: new PrismaNS.Decimal(qty),
            unitPrice: nextUnitPrice,
            currencyCode: nextUnitPrice
              ? (priorAgreement?.currencyCode ?? "LKR")
              : null,
            availableDate,
            availableSplits: persistedSplits(line),
            notes: line.notes ?? null,
            reservedAt,
            reserveExpiresAt,
            submittedAt: nextStatus === "SUBMITTED" ? now : existing.submittedAt,
            cancelledAt: null,
            cancelReason: null,
            version: { increment: 1 },
          },
        });
        assertOfferVersion(saved.count);

        const changeType =
          nextStatus === "NOT_AVAILABLE"
            ? "MARKED_NOT_AVAILABLE"
            : beforeQty.greaterThan(qty)
              ? "QUANTITY_DECREASED"
              : beforeQty.lessThan(qty)
                ? "QUANTITY_INCREASED"
                : nextUnitPrice &&
                    (!existing.unitPrice ||
                      !nextUnitPrice.equals(existing.unitPrice))
                  ? "PRICE_CHANGED"
                  : "SUBMITTED";

        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: existing.id,
            actorUserId: user.id,
            changeType,
            quantityDeclaredBefore: existing.quantityDeclared,
            quantityDeclaredAfter: new PrismaNS.Decimal(qty),
            quantityOrderedActiveBefore: existing.quantityOrderedActive,
            quantityOrderedActiveAfter: existing.quantityOrderedActive,
            unitPriceBefore: existing.unitPrice,
            unitPriceAfter: nextUnitPrice,
            statusBefore: existing.status,
            statusAfter: nextStatus,
            availableDateBefore: existing.availableDate,
            availableDateAfter: availableDate,
            warningBelowOrdered,
          },
        });

        if (
          nextStatus === "SUBMITTED" &&
          line.unitPrice != null &&
          !agreementLocked
        ) {
          const prior = priorAgreement;
          const samePrice =
            prior != null && prior.unitPrice.equals(nextUnitPrice!);
          if (!samePrice) {
            try {
              await recordSupplierAvailabilityPrice(tx, {
                offerId: existing.id,
                companyId: request.companyId,
                supplierId: user.supplierId!,
                productId: item.productId,
                requestItemId: item.id,
                supplierRequestId: request.id,
                unitPrice: line.unitPrice,
                currencyCode: "LKR",
                quantityContext: qty,
                availableDate,
                actorUserId: user.id,
                existingAgreement: prior,
              });
            } catch (error) {
              if (isPricingDomainError(error)) {
                throw new RequestDomainError("VALIDATION", error.message, {
                  [`${item.id}:unitPrice`]: error.message,
                });
              }
              throw error;
            }
          }
        }

        if (
          wasSubmitted &&
          nextStatus === "SUBMITTED" &&
          qty.lessThan(beforeQty)
        ) {
          notifiedDecrease = true;
        }
      } else {
        const offerId = createId();
        await tx.availabilityOffer.create({
          data: {
            id: offerId,
            requestItemId: item.id,
            supplierId: user.supplierId!,
            status: nextStatus,
            quantityDeclared: new PrismaNS.Decimal(qty),
            unitPrice: nextUnitPrice,
            currencyCode: nextUnitPrice ? "LKR" : null,
            availableDate,
            availableSplits: persistedSplits(line),
            notes: line.notes ?? null,
            reservedAt,
            reserveExpiresAt,
            submittedAt: nextStatus === "SUBMITTED" ? now : null,
          },
        });
        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: offerId,
            actorUserId: user.id,
            changeType:
              nextStatus === "NOT_AVAILABLE"
                ? "MARKED_NOT_AVAILABLE"
                : "SUBMITTED",
            quantityDeclaredAfter: new PrismaNS.Decimal(qty),
            unitPriceAfter: nextUnitPrice,
            statusAfter: nextStatus,
            availableDateAfter: availableDate,
          },
        });

        if (nextStatus === "SUBMITTED" && line.unitPrice != null) {
          try {
            await recordSupplierAvailabilityPrice(tx, {
              offerId,
              companyId: request.companyId,
              supplierId: user.supplierId!,
              productId: item.productId,
              requestItemId: item.id,
              supplierRequestId: request.id,
              unitPrice: line.unitPrice,
              currencyCode: "LKR",
              quantityContext: qty,
              availableDate,
              actorUserId: user.id,
              existingAgreement: null,
            });
          } catch (error) {
            if (isPricingDomainError(error)) {
              throw new RequestDomainError("VALIDATION", error.message, {
                [`${item.id}:unitPrice`]: error.message,
              });
            }
            throw error;
          }
        }
      }

      submittedCount += 1;
    }

    if (submittedCount === 0) {
      const fieldErrors = Object.fromEntries(
        request.items.map((item) => [
          `${item.id}:quantity`,
          "Enter a quantity or mark not available.",
        ]),
      );
      throw new RequestDomainError(
        "VALIDATION",
        "Enter at least one quantity or mark items not available before submitting.",
        fieldErrors,
      );
    }

    const refreshed = await tx.availabilityOffer.findMany({
      where: {
        requestItem: { supplierRequestId: request.id },
      },
      select: { status: true },
    });
    const nextRequestStatus = deriveRequestStatus(
      refreshed,
      request.items.length,
    );

    await tx.supplierRequest.update({
      where: { id: request.id },
      data: {
        status: nextRequestStatus,
        respondedAt:
          nextRequestStatus === "RESPONDED" ||
          nextRequestStatus === "PARTIALLY_RESPONDED"
            ? now
            : request.respondedAt,
      },
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Supplier",
      entityId: user.supplierId!,
      action: "UPDATE",
      afterJson: {
        event: "AVAILABILITY_SUBMITTED",
        supplierRequestId: request.id,
        submittedCount,
        requestStatus: nextRequestStatus,
        availabilityByDate: parsed.data.lines.flatMap((line) => {
          const prior = readAvailabilitySplits(itemById.get(line.requestItemId)?.availabilityOffer?.availableSplits);
          if (!prior.length && !line.splits?.length) return [];
          if (parseQty(line) == null) return [];
          return [{
            requestItemId: line.requestItemId,
            before: prior,
            after: line.splits ?? [],
          }];
        }),
      },
    });

    await notifyCompanyStaff({
      tx,
      companyId: request.companyId,
      title: notifiedDecrease
        ? "Supplier reduced availability"
        : "Supplier availability update",
      body: notifiedDecrease
        ? "A supplier decreased previously submitted availability."
        : "A supplier submitted availability for a request.",
      entityId: request.id,
    });
  });

  return { id: request.id, submittedCount };
}

/** Lazy-expire SUBMITTED offers past reserveExpiresAt (read-side + optional persist). */
export async function expireOfferIfNeeded(offerId: string, supplierId: string) {
  const now = new Date();
  const offer = await prisma.availabilityOffer.findFirst({
    where: { id: offerId, supplierId },
  });
  if (
    !offer ||
    offer.status !== "SUBMITTED" ||
    !offer.reserveExpiresAt ||
    offer.reserveExpiresAt.getTime() > now.getTime()
  ) {
    return offer;
  }

  return prisma.$transaction(async (tx) => {
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
    return tx.availabilityOffer.findUniqueOrThrow({ where: { id: offer.id } });
  });
}

export async function getSupplierRequestForSupplier(supplierRequestId: string) {
  const user = await requireSupplier();
  const supplierId = user.supplierId!;
  const request = await loadOwnedRequest(supplierRequestId, supplierId);
  const candidateIds = request.items.filter(({ product, availabilityOffer }) =>
    product.unitOfMeasure?.trim() &&
    (!availabilityOffer || (availabilityOffer.status === "DRAFT" &&
      availabilityOffer.unitPrice === null && !availabilityOffer.priceAgreement)),
  ).map(({ product }) => product.id);
  const savedRows = await loadSavedRequestPrices({
    companyId: user.companyId,
    supplierId,
  }, [...new Set(candidateIds)]).catch(() => []);
  const savedPrices = new Map(savedRows.map((price) => [price.productId, price]));

  const counterProductIds = request.items
    .filter(
      (item) =>
        item.availabilityOffer?.priceAgreement?.status === "COUNTER_PENDING" &&
        item.availabilityOffer.priceAgreement.currentQuote?.kind ===
          "COMPANY_COUNTER",
    )
    .map((item) => item.product.id);

  const lastPurchases = await loadLastPurchasesForSupplierProducts({
    companyId: user.companyId,
    supplierId,
    productIds: counterProductIds,
  });

  const items = [];
  for (const item of request.items) {
    const agreement = item.availabilityOffer?.priceAgreement ?? null;
    let offer = item.availabilityOffer;
    if (offer) {
      const expired = await expireOfferIfNeeded(offer.id, supplierId);
      offer = expired
        ? {
            ...offer,
            status: expired.status,
            version: expired.version,
            reservedAt: expired.reservedAt,
            reserveExpiresAt: expired.reserveExpiresAt,
            quantityDeclared: expired.quantityDeclared,
            quantityOrderedActive: expired.quantityOrderedActive,
            unitPrice: expired.unitPrice,
            availableDate: expired.availableDate,
            notes: expired.notes,
          }
        : offer;
    }

    let negotiation: CounterNegotiationDisplay | null = null;
    let supplierQuotedUnitPrice: string | null = null;

    if (
      agreement?.status === "COUNTER_PENDING" &&
      agreement.currentQuote?.kind === "COMPANY_COUNTER"
    ) {
      const current = agreement.currentQuote;
      const excludeQuoteIds = [
        current.id,
        current.supersedesQuote?.id,
      ].filter((id): id is string => Boolean(id));

      const previousQuoted = await loadPreviousSupplierQuotedPrice({
        companyId: user.companyId,
        supplierId,
        productId: item.product.id,
        excludeQuoteIds,
        excludeOfferId: offer?.id ?? null,
      });

      negotiation = buildCounterNegotiationDisplay({
        currentQuote: current,
        currencyCodeFallback: agreement.currencyCode,
        lastPurchase: lastPurchases.get(item.product.id) ?? null,
        previousQuotedPrice: previousQuoted,
      });
      supplierQuotedUnitPrice =
        negotiation.currentSupplierQuote?.unitPrice ?? null;
    } else if (agreement && agreement.currentQuote?.kind !== "COMPANY_COUNTER") {
      supplierQuotedUnitPrice = agreement.unitPrice.toString();
    } else if (offer?.unitPrice != null) {
      supplierQuotedUnitPrice = offer.unitPrice.toString();
    }

    const savedCataloguePrice = compatibleCataloguePrice(savedPrices.get(item.product.id), item.product.unitOfMeasure);
    items.push({
      id: item.id,
      quantityRequested: item.quantityRequested.toString(),
      product: item.product,
      savedCataloguePrice,
      offer: offer
        ? {
            id: offer.id,
            status: offer.status,
            quantityDeclared: offer.quantityDeclared.toString(),
            quantityOrderedActive: offer.quantityOrderedActive.toString(),
            /** Live offer pointer — may equal company counter while COUNTER_PENDING. */
            unitPrice: offer.unitPrice?.toString() ?? null,
            /**
             * Supplier's own current quote for editable fields.
             * Never the unaccepted company counter while COUNTER_PENDING.
             */
            supplierQuotedUnitPrice,
            availableDate: offer.availableDate,
            splits: readAvailabilitySplits(offer.availableSplits),
            reservedAt: offer.reservedAt,
            reserveExpiresAt: offer.reserveExpiresAt,
            notes: offer.notes,
            version: offer.version,
            priceAgreement: agreement
              ? {
                  status: agreement.status,
                  version: agreement.version,
                  unitPrice: agreement.unitPrice.toString(),
                  channel: agreement.channel,
                  currentQuoteKind: agreement.currentQuote?.kind ?? null,
                }
              : null,
            negotiation,
          }
        : null,
    });
  }

  return {
    id: request.id,
    status: request.status,
    responseDeadline: request.responseDeadline,
    sentAt: request.sentAt,
    brandId: request.brandId,
    brand: request.brand,
    items,
  };
}
