import "server-only";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { PricingDomainError } from "./errors";
import { isAgreedPriceStatus } from "./status";

/**
 * Company-scoped price comparison for one product (staff).
 * Distinguishes live quotes from actual purchased OrderItem prices.
 */
export async function getProductPriceComparison(productId: string) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: user.companyId },
    select: {
      id: true,
      name: true,
      sku: true,
      unitOfMeasure: true,
      companyId: true,
    },
  });
  if (!product) {
    throw new PricingDomainError("NOT_FOUND", "Product not found.");
  }

  const liveOffers = await prisma.availabilityOffer.findMany({
    where: {
      status: "SUBMITTED",
      requestItem: {
        productId,
        supplierRequest: { companyId: user.companyId },
      },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      requestItem: {
        select: {
          id: true,
          quantityRequested: true,
          supplierRequestId: true,
        },
      },
      priceAgreement: {
        include: {
          currentQuote: true,
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  const quoteHistory = await prisma.priceQuote.findMany({
    where: {
      companyId: user.companyId,
      productId,
      status: { not: "SUPERSEDED" },
    },
    include: {
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const allQuotesIncludingSuperseded = await prisma.priceQuote.findMany({
    where: { companyId: user.companyId, productId },
    select: {
      id: true,
      supplierId: true,
      unitPrice: true,
      kind: true,
      status: true,
      channel: true,
      createdAt: true,
      availabilityOfferId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const purchased = await prisma.orderItem.findMany({
    where: {
      companyId: user.companyId,
      productId,
      unitPrice: { not: null },
      purchaseOrder: {
        status: {
          in: ["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED"],
        },
      },
    },
    select: {
      id: true,
      unitPrice: true,
      supplierId: true,
      priceQuoteId: true,
      priceAgreementStatusAtOrder: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          orderNumber: true,
          status: true,
          confirmedAt: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const lastPoPrice = purchased[0] ?? null;
  const lowestPurchased =
    purchased.length === 0
      ? null
      : purchased.reduce((best, row) => {
          if (!row.unitPrice) return best;
          if (!best?.unitPrice) return row;
          return row.unitPrice.lessThan(best.unitPrice) ? row : best;
        }, purchased[0]);

  const lowestQuoted =
    quoteHistory.length === 0
      ? null
      : quoteHistory.reduce((best, row) =>
          row.unitPrice.lessThan(best.unitPrice) ? row : best,
        );

  const currentBySupplier = liveOffers.map((offer) => {
    const agreement = offer.priceAgreement;
    const priorSameSupplier = allQuotesIncludingSuperseded.find(
      (q) =>
        q.supplierId === offer.supplierId &&
        q.id !== agreement?.currentQuoteId &&
        (agreement
          ? q.createdAt < agreement.currentQuote.createdAt
          : true),
    );
    return {
      availabilityOfferId: offer.id,
      supplier: offer.supplier,
      quantityDeclared: offer.quantityDeclared.toString(),
      quantityOrderedActive: offer.quantityOrderedActive.toString(),
      availableDate: offer.availableDate,
      offerUnitPrice: offer.unitPrice?.toString() ?? null,
      agreement: agreement
        ? {
            status: agreement.status,
            version: agreement.version,
            unitPrice: agreement.unitPrice.toString(),
            channel: agreement.channel,
            currentQuoteId: agreement.currentQuoteId,
            currentKind: agreement.currentQuote.kind,
            isAgreed: isAgreedPriceStatus(agreement.status),
          }
        : null,
      previousPriceSameSupplier: priorSameSupplier
        ? {
            unitPrice: priorSameSupplier.unitPrice.toString(),
            kind: priorSameSupplier.kind,
            status: priorSameSupplier.status,
            createdAt: priorSameSupplier.createdAt,
          }
        : null,
      requestItemId: offer.requestItem.id,
      supplierRequestId: offer.requestItem.supplierRequestId,
    };
  });

  const otherSupplierPast = allQuotesIncludingSuperseded
    .filter((q) => !liveOffers.some((o) => o.supplierId === q.supplierId && o.id === q.availabilityOfferId))
    .slice(0, 40);

  return {
    product,
    currentOffers: currentBySupplier,
    quoteHistory: quoteHistory.map((q) => ({
      id: q.id,
      supplier: q.supplier,
      unitPrice: q.unitPrice.toString(),
      kind: q.kind,
      status: q.status,
      channel: q.channel,
      createdAt: q.createdAt,
      availabilityOfferId: q.availabilityOfferId,
      sourceType: "QUOTED" as const,
    })),
    purchasedHistory: purchased.map((p) => ({
      id: p.id,
      supplier: p.purchaseOrder.supplier,
      unitPrice: p.unitPrice!.toString(),
      orderNumber: p.purchaseOrder.orderNumber,
      poStatus: p.purchaseOrder.status,
      createdAt: p.createdAt,
      priceQuoteId: p.priceQuoteId,
      priceAgreementStatusAtOrder: p.priceAgreementStatusAtOrder,
      sourceType: "PURCHASED" as const,
    })),
    lastActualPurchaseOrderPrice: lastPoPrice
      ? {
          unitPrice: lastPoPrice.unitPrice!.toString(),
          orderNumber: lastPoPrice.purchaseOrder.orderNumber,
          supplier: lastPoPrice.purchaseOrder.supplier,
          createdAt: lastPoPrice.createdAt,
        }
      : null,
    lowestComparableHistoricalPrice: {
      quoted: lowestQuoted
        ? {
            unitPrice: lowestQuoted.unitPrice.toString(),
            supplierId: lowestQuoted.supplierId,
            kind: lowestQuoted.kind,
            sourceType: "QUOTED" as const,
          }
        : null,
      purchased: lowestPurchased?.unitPrice
        ? {
            unitPrice: lowestPurchased.unitPrice.toString(),
            supplierId: lowestPurchased.supplierId,
            orderNumber: lowestPurchased.purchaseOrder.orderNumber,
            sourceType: "PURCHASED" as const,
          }
        : null,
      /** Prefer actual purchased low when present; else lowest quote. */
      recommended:
        lowestPurchased?.unitPrice != null
          ? {
              unitPrice: lowestPurchased.unitPrice.toString(),
              sourceType: "PURCHASED" as const,
            }
          : lowestQuoted
            ? {
                unitPrice: lowestQuoted.unitPrice.toString(),
                sourceType: "QUOTED" as const,
              }
            : null,
    },
    otherSupplierPastQuotes: otherSupplierPast.map((q) => ({
      id: q.id,
      supplierId: q.supplierId,
      unitPrice: q.unitPrice.toString(),
      kind: q.kind,
      status: q.status,
      channel: q.channel,
      createdAt: q.createdAt,
    })),
  };
}

export async function getOfferPriceThread(availabilityOfferId: string) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const offer = await prisma.availabilityOffer.findFirst({
    where: {
      id: availabilityOfferId,
      requestItem: { supplierRequest: { companyId: user.companyId } },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      requestItem: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, unitOfMeasure: true },
          },
          supplierRequest: { select: { id: true, companyId: true } },
        },
      },
      priceAgreement: true,
      priceQuotes: {
        orderBy: { createdAt: "asc" },
        include: {
          recordedBy: { select: { id: true, name: true, email: true } },
          attestedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!offer) {
    throw new PricingDomainError("NOT_FOUND", "Offer not found.");
  }
  return offer;
}
