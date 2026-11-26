import "server-only";

import type {
  PriceAgreementStatus,
  PriceNegotiationChannel,
  PriceQuoteKind,
  Prisma,
} from "@/generated/prisma/client";
import { Prisma as PrismaNS } from "@/generated/prisma/client";

import {
  requireStaffPermission,
  requireSupplierOwnership,
} from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import {
  notifyCompanyUsersOfPriceAcceptance,
  notifyCompanyUsersOfPriceRevision,
  notifySupplierUsersOfPriceCounter,
} from "@/lib/notifications";

import { PricingDomainError } from "./errors";
import {
  staffAttestAgreementSchema,
  staffCounterOfferSchema,
  staffRecordExternalSchema,
  supplierAcceptCounterSchema,
  supplierReviseOfferSchema,
} from "./schema";
import { canTransition } from "./status";

type Tx = Prisma.TransactionClient;

type OfferContext = {
  id: string;
  supplierId: string;
  status: string;
  quantityDeclared: Prisma.Decimal;
  availableDate: Date | null;
  reservedAt: Date | null;
  reserveExpiresAt: Date | null;
  unitPrice: Prisma.Decimal | null;
  currencyCode: string | null;
  version: number;
  requestItem: {
    id: string;
    productId: string;
    supplierRequestId: string;
    supplierRequest: {
      id: string;
      companyId: string;
      supplierId: string;
    };
  };
  priceAgreement: {
    id: string;
    status: PriceAgreementStatus;
    currentQuoteId: string;
    unitPrice: Prisma.Decimal;
    currencyCode: string | null;
    channel: PriceNegotiationChannel;
    version: number;
    currentQuote: {
      id: string;
      unitPrice: Prisma.Decimal;
      status: PriceAgreementStatus;
      kind: PriceQuoteKind;
      availabilityOfferId: string | null;
    };
  } | null;
};

async function loadOfferContext(
  tx: Tx,
  availabilityOfferId: string,
): Promise<OfferContext | null> {
  return tx.availabilityOffer.findFirst({
    where: { id: availabilityOfferId },
    include: {
      requestItem: {
        include: {
          supplierRequest: {
            select: { id: true, companyId: true, supplierId: true },
          },
        },
      },
      priceAgreement: {
        include: {
          currentQuote: {
            select: {
              id: true,
              unitPrice: true,
              status: true,
              kind: true,
              availabilityOfferId: true,
            },
          },
        },
      },
    },
  });
}

function requireTransition(
  from: PriceAgreementStatus,
  to: PriceAgreementStatus,
) {
  if (!canTransition(from, to)) {
    throw new PricingDomainError(
      "INVALID_STATUS",
      `Cannot move price agreement from ${from} to ${to}.`,
    );
  }
}

async function supersedeCurrentQuote(
  tx: Tx,
  agreement: NonNullable<OfferContext["priceAgreement"]>,
) {
  await tx.priceQuote.update({
    where: { id: agreement.currentQuoteId },
    data: { status: "SUPERSEDED" },
  });
}

async function bumpAgreementOrThrow(
  tx: Tx,
  args: {
    agreementId: string;
    expectedVersion: number;
    status: PriceAgreementStatus;
    currentQuoteId: string;
    unitPrice: Prisma.Decimal;
    currencyCode: string | null;
    channel: PriceNegotiationChannel;
  },
) {
  const updated = await tx.priceAgreement.updateMany({
    where: { id: args.agreementId, version: args.expectedVersion },
    data: {
      status: args.status,
      currentQuoteId: args.currentQuoteId,
      unitPrice: args.unitPrice,
      currencyCode: args.currencyCode,
      channel: args.channel,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new PricingDomainError(
      "STALE_VERSION",
      "This price agreement was updated elsewhere. Reload and try again.",
    );
  }
}

/**
 * On positive availability submit: append SUPPLIER_ORIGINAL (or REVISED if
 * an agreement already exists) and point PriceAgreement at QUOTED.
 * Never updates prior quote unitPrice rows.
 */
export async function recordSupplierAvailabilityPrice(
  tx: Tx,
  args: {
    offerId: string;
    companyId: string;
    supplierId: string;
    productId: string;
    requestItemId: string;
    supplierRequestId: string;
    unitPrice: number;
    currencyCode?: string | null;
    quantityContext: number | Prisma.Decimal;
    availableDate: Date | null;
    actorUserId: string;
    existingAgreement: OfferContext["priceAgreement"];
  },
) {
  const unitPrice = new PrismaNS.Decimal(args.unitPrice);
  if (unitPrice.lessThanOrEqualTo(0)) {
    throw new PricingDomainError(
      "VALIDATION",
      "Unit price must be greater than zero.",
    );
  }

  const prior = args.existingAgreement;
  if (prior) {
    requireTransition(prior.status, "QUOTED");
    await supersedeCurrentQuote(tx, prior);
  }

  const quoteId = createId();
  const kind: PriceQuoteKind = prior ? "SUPPLIER_REVISED" : "SUPPLIER_ORIGINAL";

  await tx.priceQuote.create({
    data: {
      id: quoteId,
      companyId: args.companyId,
      supplierId: args.supplierId,
      productId: args.productId,
      availabilityOfferId: args.offerId,
      requestItemId: args.requestItemId,
      supplierRequestId: args.supplierRequestId,
      channel: "PORTAL",
      kind,
      status: "QUOTED",
      unitPrice,
      currencyCode: args.currencyCode ?? "LKR",
      quantityContext: new PrismaNS.Decimal(args.quantityContext),
      availableDate: args.availableDate,
      recordedByUserId: args.actorUserId,
      supersedesQuoteId: prior?.currentQuoteId ?? null,
    },
  });

  if (prior) {
    await bumpAgreementOrThrow(tx, {
      agreementId: prior.id,
      expectedVersion: prior.version,
      status: "QUOTED",
      currentQuoteId: quoteId,
      unitPrice,
      currencyCode: args.currencyCode ?? "LKR",
      channel: "PORTAL",
    });
  } else {
    await tx.priceAgreement.create({
      data: {
        id: createId(),
        companyId: args.companyId,
        supplierId: args.supplierId,
        productId: args.productId,
        availabilityOfferId: args.offerId,
        requestItemId: args.requestItemId,
        status: "QUOTED",
        currentQuoteId: quoteId,
        unitPrice,
        currencyCode: args.currencyCode ?? "LKR",
        channel: "PORTAL",
        version: 1,
      },
    });
  }

  return quoteId;
}

export async function staffCounterOffer(raw: unknown) {
  const parsed = staffCounterOfferSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid counteroffer.",
    );
  }
  const user = await requireStaffPermission("ALLOCATE_ORDER");

  return prisma.$transaction(async (tx) => {
    const offer = await loadOfferContext(tx, parsed.data.availabilityOfferId);
    if (!offer || offer.requestItem.supplierRequest.companyId !== user.companyId) {
      throw new PricingDomainError("NOT_FOUND", "Offer not found.");
    }
    const agreement = offer.priceAgreement;
    if (!agreement) {
      throw new PricingDomainError(
        "INVALID_STATUS",
        "No current price quote to counter.",
      );
    }
    requireTransition(agreement.status, "COUNTER_PENDING");

    const unitPrice = new PrismaNS.Decimal(parsed.data.unitPrice);
    await supersedeCurrentQuote(tx, agreement);

    const quoteId = createId();
    await tx.priceQuote.create({
      data: {
        id: quoteId,
        companyId: user.companyId,
        supplierId: offer.supplierId,
        productId: offer.requestItem.productId,
        availabilityOfferId: offer.id,
        requestItemId: offer.requestItem.id,
        supplierRequestId: offer.requestItem.supplierRequestId,
        channel: "PORTAL",
        kind: "COMPANY_COUNTER",
        status: "COUNTER_PENDING",
        unitPrice,
        currencyCode: agreement.currencyCode ?? "LKR",
        notes: parsed.data.notes ?? null,
        recordedByUserId: user.id,
        supersedesQuoteId: agreement.currentQuoteId,
      },
    });

    await bumpAgreementOrThrow(tx, {
      agreementId: agreement.id,
      expectedVersion: parsed.data.expectedVersion,
      status: "COUNTER_PENDING",
      currentQuoteId: quoteId,
      unitPrice,
      currencyCode: agreement.currencyCode ?? "LKR",
      channel: "PORTAL",
    });

    await tx.availabilityOffer.update({
      where: { id: offer.id },
      data: {
        unitPrice,
        currencyCode: agreement.currencyCode ?? "LKR",
      },
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "SupplierRequest",
      entityId: offer.requestItem.supplierRequestId,
      action: "UPDATE",
      afterJson: {
        event: "PRICE_COMPANY_COUNTER",
        availabilityOfferId: offer.id,
        quoteId,
        unitPrice: unitPrice.toString(),
      },
    });

    const product = await tx.product.findFirst({
      where: { id: offer.requestItem.productId },
      select: { name: true },
    });

    await notifySupplierUsersOfPriceCounter({
      tx,
      companyId: user.companyId,
      supplierId: offer.supplierId,
      availabilityOfferId: offer.id,
      supplierRequestId: offer.requestItem.supplierRequestId,
      productName: product?.name ?? "Item",
      counterPrice: unitPrice.toString(),
      currencyCode: agreement.currencyCode ?? "LKR",
    });

    return {
      quoteId,
      availabilityOfferId: offer.id,
      supplierRequestId: offer.requestItem.supplierRequestId,
    };
  });
}

export async function supplierReviseOffer(raw: unknown) {
  const parsed = supplierReviseOfferSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid revised offer.",
    );
  }

  const offerPeek = await prisma.availabilityOffer.findFirst({
    where: { id: parsed.data.availabilityOfferId },
    select: { supplierId: true },
  });
  if (!offerPeek) {
    throw new PricingDomainError("NOT_FOUND", "Offer not found.");
  }
  const user = await requireSupplierOwnership(offerPeek.supplierId);

  return prisma.$transaction(async (tx) => {
    const offer = await loadOfferContext(tx, parsed.data.availabilityOfferId);
    if (!offer || offer.supplierId !== user.supplierId) {
      throw new PricingDomainError("NOT_FOUND", "Offer not found.");
    }
    const agreement = offer.priceAgreement;
    if (!agreement) {
      throw new PricingDomainError(
        "INVALID_STATUS",
        "No price thread to revise.",
      );
    }
    requireTransition(agreement.status, "QUOTED");

    const unitPrice = new PrismaNS.Decimal(parsed.data.unitPrice);
    await supersedeCurrentQuote(tx, agreement);

    const quoteId = createId();
    await tx.priceQuote.create({
      data: {
        id: quoteId,
        companyId: offer.requestItem.supplierRequest.companyId,
        supplierId: offer.supplierId,
        productId: offer.requestItem.productId,
        availabilityOfferId: offer.id,
        requestItemId: offer.requestItem.id,
        supplierRequestId: offer.requestItem.supplierRequestId,
        channel: "PORTAL",
        kind: "SUPPLIER_REVISED",
        status: "QUOTED",
        unitPrice,
        currencyCode: agreement.currencyCode ?? "LKR",
        notes: parsed.data.notes ?? null,
        recordedByUserId: user.id,
        supersedesQuoteId: agreement.currentQuoteId,
      },
    });

    await bumpAgreementOrThrow(tx, {
      agreementId: agreement.id,
      expectedVersion: parsed.data.expectedVersion,
      status: "QUOTED",
      currentQuoteId: quoteId,
      unitPrice,
      currencyCode: agreement.currencyCode ?? "LKR",
      channel: "PORTAL",
    });

    await tx.availabilityOffer.update({
      where: { id: offer.id },
      data: { unitPrice, currencyCode: agreement.currencyCode ?? "LKR" },
    });

    const companyId = offer.requestItem.supplierRequest.companyId;
    const product = await tx.product.findFirst({
      where: { id: offer.requestItem.productId },
      select: { name: true },
    });
    const supplier = await tx.supplier.findFirst({
      where: { id: offer.supplierId, companyId },
      select: { name: true },
    });

    await notifyCompanyUsersOfPriceRevision({
      tx,
      companyId,
      availabilityOfferId: offer.id,
      supplierRequestId: offer.requestItem.supplierRequestId,
      productName: product?.name ?? "Item",
      unitPrice: unitPrice.toString(),
      currencyCode: agreement.currencyCode ?? "LKR",
      supplierName: supplier?.name,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "SupplierRequest",
      entityId: offer.requestItem.supplierRequestId,
      action: "UPDATE",
      afterJson: {
        event: "PRICE_SUPPLIER_REVISED",
        availabilityOfferId: offer.id,
        quoteId,
        unitPrice: unitPrice.toString(),
      },
    });

    return {
      quoteId,
      availabilityOfferId: offer.id,
      supplierRequestId: offer.requestItem.supplierRequestId,
    };
  });
}

export async function supplierAcceptCounter(raw: unknown) {
  const parsed = supplierAcceptCounterSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid acceptance.",
    );
  }

  const offerPeek = await prisma.availabilityOffer.findFirst({
    where: { id: parsed.data.availabilityOfferId },
    select: { supplierId: true },
  });
  if (!offerPeek) {
    throw new PricingDomainError("NOT_FOUND", "Offer not found.");
  }
  const user = await requireSupplierOwnership(offerPeek.supplierId);

  return prisma.$transaction(async (tx) => {
    const offer = await loadOfferContext(tx, parsed.data.availabilityOfferId);
    if (!offer || offer.supplierId !== user.supplierId) {
      throw new PricingDomainError("NOT_FOUND", "Offer not found.");
    }
    const agreement = offer.priceAgreement;
    const companyId = offer.requestItem.supplierRequest.companyId;
    const supplierRequestId = offer.requestItem.supplierRequestId;
    const currencyCode = agreement?.currencyCode ?? "LKR";

    // Idempotent replay: already confirmed acceptance — no duplicate quote/notify.
    if (
      agreement &&
      agreement.status === "SUPPLIER_CONFIRMED" &&
      agreement.currentQuote.kind === "SUPPLIER_ACCEPTANCE"
    ) {
      return {
        quoteId: agreement.currentQuoteId,
        availabilityOfferId: offer.id,
        supplierRequestId,
        unitPrice: agreement.unitPrice.toString(),
        currencyCode,
        alreadyConfirmed: true as const,
      };
    }

    if (!agreement || agreement.status !== "COUNTER_PENDING") {
      throw new PricingDomainError(
        "INVALID_STATUS",
        "No pending company counter to accept.",
      );
    }
    if (agreement.currentQuote.kind !== "COMPANY_COUNTER") {
      throw new PricingDomainError(
        "INVALID_STATUS",
        "Current quote is not a company counteroffer.",
      );
    }
    requireTransition(agreement.status, "SUPPLIER_CONFIRMED");

    const unitPrice = agreement.currentQuote.unitPrice;
    // Snapshot before update — accept must not touch qty / date / reserve.
    const qtyBefore = offer.quantityDeclared;
    const dateBefore = offer.availableDate;
    const reservedAtBefore = offer.reservedAt;
    const reserveExpiresBefore = offer.reserveExpiresAt;

    await supersedeCurrentQuote(tx, agreement);

    const quoteId = createId();
    await tx.priceQuote.create({
      data: {
        id: quoteId,
        companyId,
        supplierId: offer.supplierId,
        productId: offer.requestItem.productId,
        availabilityOfferId: offer.id,
        requestItemId: offer.requestItem.id,
        supplierRequestId,
        channel: "PORTAL",
        kind: "SUPPLIER_ACCEPTANCE",
        status: "SUPPLIER_CONFIRMED",
        unitPrice,
        currencyCode,
        recordedByUserId: user.id,
        supersedesQuoteId: agreement.currentQuoteId,
      },
    });

    await bumpAgreementOrThrow(tx, {
      agreementId: agreement.id,
      expectedVersion: parsed.data.expectedVersion,
      status: "SUPPLIER_CONFIRMED",
      currentQuoteId: quoteId,
      unitPrice,
      currencyCode,
      channel: "PORTAL",
    });

    // Price denormalization only — never reset reserve or change qty/date.
    await tx.availabilityOffer.update({
      where: { id: offer.id },
      data: { unitPrice, currencyCode },
    });

    const product = await tx.product.findFirst({
      where: { id: offer.requestItem.productId },
      select: { name: true },
    });
    const supplier = await tx.supplier.findFirst({
      where: { id: offer.supplierId, companyId },
      select: { name: true },
    });

    await notifyCompanyUsersOfPriceAcceptance({
      tx,
      companyId,
      availabilityOfferId: offer.id,
      supplierRequestId,
      productName: product?.name ?? "Item",
      unitPrice: unitPrice.toString(),
      currencyCode,
      supplierName: supplier?.name,
      confirmedAt: new Date(),
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "SupplierRequest",
      entityId: supplierRequestId,
      action: "UPDATE",
      afterJson: {
        event: "PRICE_SUPPLIER_ACCEPTED",
        availabilityOfferId: offer.id,
        quoteId,
        unitPrice: unitPrice.toString(),
        quantityDeclaredUnchanged: qtyBefore.toString(),
        availableDateUnchanged: dateBefore?.toISOString() ?? null,
        reservedAtUnchanged: reservedAtBefore?.toISOString() ?? null,
        reserveExpiresAtUnchanged: reserveExpiresBefore?.toISOString() ?? null,
      },
    });

    return {
      quoteId,
      availabilityOfferId: offer.id,
      supplierRequestId,
      unitPrice: unitPrice.toString(),
      currencyCode,
      alreadyConfirmed: false as const,
    };
  });
}

export async function staffRecordExternalNegotiation(raw: unknown) {
  const parsed = staffRecordExternalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid external negotiation.",
    );
  }
  const user = await requireStaffPermission("ALLOCATE_ORDER");

  return prisma.$transaction(async (tx) => {
    const offer = await loadOfferContext(tx, parsed.data.availabilityOfferId);
    if (!offer || offer.requestItem.supplierRequest.companyId !== user.companyId) {
      throw new PricingDomainError("NOT_FOUND", "Offer not found.");
    }

    const agreement = offer.priceAgreement;
    if (agreement) {
      requireTransition(agreement.status, "STAFF_RECORDED_UNCONFIRMED");
      await supersedeCurrentQuote(tx, agreement);
    }

    const unitPrice = new PrismaNS.Decimal(parsed.data.unitPrice);
    const quoteId = createId();
    const negotiationOccurredAt = new Date(parsed.data.negotiationOccurredAt);

    await tx.priceQuote.create({
      data: {
        id: quoteId,
        companyId: user.companyId,
        supplierId: offer.supplierId,
        productId: offer.requestItem.productId,
        availabilityOfferId: offer.id,
        requestItemId: offer.requestItem.id,
        supplierRequestId: offer.requestItem.supplierRequestId,
        channel: parsed.data.channel,
        kind: "STAFF_RECORDED_EXTERNAL",
        status: "STAFF_RECORDED_UNCONFIRMED",
        unitPrice,
        currencyCode: "LKR",
        notes: parsed.data.notes ?? null,
        negotiationOccurredAt,
        recordedByUserId: user.id,
        supersedesQuoteId: agreement?.currentQuoteId ?? null,
      },
    });

    if (agreement) {
      await bumpAgreementOrThrow(tx, {
        agreementId: agreement.id,
        expectedVersion: parsed.data.expectedVersion,
        status: "STAFF_RECORDED_UNCONFIRMED",
        currentQuoteId: quoteId,
        unitPrice,
        currencyCode: "LKR",
        channel: parsed.data.channel,
      });
    } else {
      await tx.priceAgreement.create({
        data: {
          id: createId(),
          companyId: user.companyId,
          supplierId: offer.supplierId,
          productId: offer.requestItem.productId,
          availabilityOfferId: offer.id,
          requestItemId: offer.requestItem.id,
          status: "STAFF_RECORDED_UNCONFIRMED",
          currentQuoteId: quoteId,
          unitPrice,
          currencyCode: "LKR",
          channel: parsed.data.channel,
          version: 1,
        },
      });
    }

    await tx.availabilityOffer.update({
      where: { id: offer.id },
      data: { unitPrice, currencyCode: "LKR" },
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "SupplierRequest",
      entityId: offer.requestItem.supplierRequestId,
      action: "UPDATE",
      afterJson: {
        event: "PRICE_STAFF_RECORDED_EXTERNAL",
        availabilityOfferId: offer.id,
        channel: parsed.data.channel,
        quoteId,
        unitPrice: unitPrice.toString(),
      },
    });

    return { quoteId, availabilityOfferId: offer.id };
  });
}

export async function staffAttestAgreedPrice(raw: unknown) {
  const parsed = staffAttestAgreementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid attestation.",
    );
  }
  const user = await requireStaffPermission("ALLOCATE_ORDER");

  return prisma.$transaction(async (tx) => {
    const offer = await loadOfferContext(tx, parsed.data.availabilityOfferId);
    if (!offer || offer.requestItem.supplierRequest.companyId !== user.companyId) {
      throw new PricingDomainError("NOT_FOUND", "Offer not found.");
    }
    const agreement = offer.priceAgreement;
    if (!agreement || agreement.status !== "STAFF_RECORDED_UNCONFIRMED") {
      throw new PricingDomainError(
        "INVALID_STATUS",
        "Only staff-recorded unconfirmed prices can be attested.",
      );
    }
    requireTransition(agreement.status, "STAFF_ATTESTED_AGREED");

    const unitPrice = agreement.currentQuote.unitPrice;
    await supersedeCurrentQuote(tx, agreement);

    const quoteId = createId();
    const now = new Date();
    await tx.priceQuote.create({
      data: {
        id: quoteId,
        companyId: user.companyId,
        supplierId: offer.supplierId,
        productId: offer.requestItem.productId,
        availabilityOfferId: offer.id,
        requestItemId: offer.requestItem.id,
        supplierRequestId: offer.requestItem.supplierRequestId,
        channel: agreement.channel,
        kind: "STAFF_RECORDED_EXTERNAL",
        status: "STAFF_ATTESTED_AGREED",
        unitPrice,
        currencyCode: agreement.currencyCode ?? "LKR",
        attestationStatement: parsed.data.attestationStatement,
        evidenceNote: parsed.data.evidenceNote,
        attestedAt: now,
        attestedByUserId: user.id,
        recordedByUserId: user.id,
        supersedesQuoteId: agreement.currentQuoteId,
      },
    });

    await bumpAgreementOrThrow(tx, {
      agreementId: agreement.id,
      expectedVersion: parsed.data.expectedVersion,
      status: "STAFF_ATTESTED_AGREED",
      currentQuoteId: quoteId,
      unitPrice,
      currencyCode: agreement.currencyCode ?? "LKR",
      channel: agreement.channel,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "SupplierRequest",
      entityId: offer.requestItem.supplierRequestId,
      action: "UPDATE",
      afterJson: {
        event: "PRICE_STAFF_ATTESTED",
        availabilityOfferId: offer.id,
        quoteId,
        unitPrice: unitPrice.toString(),
      },
    });

    return { quoteId, availabilityOfferId: offer.id };
  });
}

/** Resolve the allocatable agreed price for an offer, or throw. */
export async function requireAgreedPriceForAllocate(
  tx: Tx,
  args: {
    availabilityOfferId: string;
    companyId: string;
    supplierId: string;
  },
) {
  const agreement = await tx.priceAgreement.findFirst({
    where: {
      availabilityOfferId: args.availabilityOfferId,
      companyId: args.companyId,
      supplierId: args.supplierId,
    },
    include: { currentQuote: true },
  });
  if (!agreement) {
    throw new PricingDomainError(
      "PRICE_NOT_AGREED",
      "No price agreement exists for this offer. Negotiate and confirm a price before allocating.",
    );
  }
  if (
    agreement.status !== "SUPPLIER_CONFIRMED" &&
    agreement.status !== "STAFF_ATTESTED_AGREED"
  ) {
    throw new PricingDomainError(
      "PRICE_NOT_AGREED",
      `Price is not agreed (status ${agreement.status}). Confirm with the supplier or attest an external agreement before allocating.`,
    );
  }
  if (
    agreement.currentQuote.availabilityOfferId !== args.availabilityOfferId
  ) {
    throw new PricingDomainError(
      "OFFER_QUOTE_MISMATCH",
      "Agreement current quote does not belong to this offer.",
    );
  }
  if (!agreement.unitPrice.equals(agreement.currentQuote.unitPrice)) {
    throw new PricingDomainError(
      "VALIDATION",
      "Agreement unit price does not match current quote.",
    );
  }
  return {
    unitPrice: agreement.unitPrice,
    priceQuoteId: agreement.currentQuoteId,
    priceAgreementStatusAtOrder: agreement.status,
    currencyCode: agreement.currencyCode,
  };
}
