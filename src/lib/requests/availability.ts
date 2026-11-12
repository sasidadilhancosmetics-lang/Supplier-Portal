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
import { createUserNotification } from "@/lib/notifications";

import { parseCalendarDateInput } from "@/lib/dates";

import { computeReserveExpiresAt } from "./constants";
import { RequestDomainError } from "./errors";
import {
  availabilityFieldErrorsFromZod,
  saveAvailabilityDraftSchema,
  submitAvailabilitySchema,
} from "./schema";

type LineInput = {
  requestItemId: string;
  quantityDeclared?: number | null;
  availableDate?: string;
  notAvailable: boolean;
  notes?: string;
  expectedVersion?: number;
};

function parseQty(line: LineInput): number | null {
  if (line.notAvailable) return 0;
  if (line.quantityDeclared === null || line.quantityDeclared === undefined) {
    return null;
  }
  const n = Number(line.quantityDeclared);
  if (!Number.isFinite(n) || n < 0) {
    throw new RequestDomainError("VALIDATION", "Invalid quantity.");
  }
  return n;
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
      items: {
        include: {
          availabilityOffer: true,
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
      if (line.notAvailable) {
        // Draft NA marker: store as DRAFT with qty 0 until submit.
      }
      if (qty !== null && qty < 0) {
        throw new RequestDomainError("VALIDATION", "Quantity cannot be negative.");
      }

      const availableDate = parseDate(line.availableDate);
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

      const declared = qty ?? 0;
      if (existing) {
        await tx.availabilityOffer.update({
          where: { id: existing.id },
          data: {
            status: "DRAFT",
            quantityDeclared: new PrismaNS.Decimal(declared),
            availableDate: line.notAvailable ? null : availableDate,
            notes: line.notes ?? null,
            reservedAt: null,
            reserveExpiresAt: null,
            version: { increment: 1 },
          },
        });
        await tx.availabilityChange.create({
          data: {
            id: createId(),
            availabilityOfferId: existing.id,
            actorUserId: user.id,
            changeType: "DRAFT_SAVED",
            quantityDeclaredBefore: existing.quantityDeclared,
            quantityDeclaredAfter: new PrismaNS.Decimal(declared),
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
            availableDate: line.notAvailable ? null : availableDate,
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

      let qty = parseQty(line);
      // Unanswered on submit: skip (remain pending).
      if (qty === null && !line.notAvailable) {
        continue;
      }

      const treatAsNa = line.notAvailable || qty === 0;
      if (treatAsNa) {
        qty = 0;
      }
      if (qty === null) {
        continue;
      }

      const availableDate = treatAsNa ? null : parseDate(line.availableDate);
      if (!treatAsNa && qty > 0 && !availableDate) {
        throw new RequestDomainError(
          "VALIDATION",
          `Delivery date required for ${item.product.name}.`,
          {
            [`${item.id}:date`]: "Enter a delivery date for this quantity.",
          },
        );
      }

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

      const nextStatus: AvailabilityOfferStatus = treatAsNa
        ? "NOT_AVAILABLE"
        : "SUBMITTED";

      // Fresh reserve clock when entering SUBMITTED from anything except live SUBMITTED.
      // While already SUBMITTED, preserve original reserveExpiresAt (no reset).
      const wasSubmitted = existing?.status === "SUBMITTED";
      const needsFreshClock =
        nextStatus === "SUBMITTED" && qty > 0 && !wasSubmitted;

      let reservedAt = existing?.reservedAt ?? null;
      let reserveExpiresAt = existing?.reserveExpiresAt ?? null;

      if (nextStatus === "NOT_AVAILABLE") {
        reservedAt = null;
        reserveExpiresAt = null;
      } else if (needsFreshClock) {
        reservedAt = now;
        reserveExpiresAt = computeReserveExpiresAt(now);
      } else if (wasSubmitted) {
        reservedAt = existing!.reservedAt;
        reserveExpiresAt = existing!.reserveExpiresAt;
      }

      // New reserve must not include qty already committed to orders.
      const orderedActive = existing
        ? Number(existing.quantityOrderedActive)
        : 0;
      if (nextStatus === "SUBMITTED" && qty < orderedActive) {
        throw new RequestDomainError(
          "VALIDATION",
          `Available quantity for ${item.product.name} cannot be below already ordered quantity (${orderedActive}).`,
        );
      }

      const warningBelowOrdered =
        nextStatus === "SUBMITTED" &&
        orderedActive > 0 &&
        qty < orderedActive;

      if (existing) {
        const beforeQty = Number(existing.quantityDeclared);
        await tx.availabilityOffer.update({
          where: { id: existing.id },
          data: {
            status: nextStatus,
            quantityDeclared: new PrismaNS.Decimal(qty),
            availableDate,
            notes: line.notes ?? null,
            reservedAt,
            reserveExpiresAt,
            submittedAt: nextStatus === "SUBMITTED" ? now : existing.submittedAt,
            cancelledAt: null,
            cancelReason: null,
            version: { increment: 1 },
          },
        });

        const changeType =
          nextStatus === "NOT_AVAILABLE"
            ? "MARKED_NOT_AVAILABLE"
            : beforeQty > qty
              ? "QUANTITY_DECREASED"
              : beforeQty < qty
                ? "QUANTITY_INCREASED"
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
            statusBefore: existing.status,
            statusAfter: nextStatus,
            availableDateBefore: existing.availableDate,
            availableDateAfter: availableDate,
            warningBelowOrdered,
          },
        });

        if (
          wasSubmitted &&
          nextStatus === "SUBMITTED" &&
          qty < beforeQty
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
            availableDate,
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
            statusAfter: nextStatus,
            availableDateAfter: availableDate,
          },
        });
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
  const request = await loadOwnedRequest(supplierRequestId, user.supplierId!);

  const items = [];
  for (const item of request.items) {
    let offer = item.availabilityOffer;
    if (offer) {
      offer = await expireOfferIfNeeded(offer.id, user.supplierId!);
    }
    items.push({
      id: item.id,
      quantityRequested: item.quantityRequested.toString(),
      product: item.product,
      offer: offer
        ? {
            id: offer.id,
            status: offer.status,
            quantityDeclared: offer.quantityDeclared.toString(),
            quantityOrderedActive: offer.quantityOrderedActive.toString(),
            availableDate: offer.availableDate,
            reservedAt: offer.reservedAt,
            reserveExpiresAt: offer.reserveExpiresAt,
            notes: offer.notes,
            version: offer.version,
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
    items,
  };
}
