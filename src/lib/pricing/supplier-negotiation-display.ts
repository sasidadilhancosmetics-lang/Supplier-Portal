import "server-only";

import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";

import type {
  CounterNegotiationDisplay,
  LastPurchasePrice,
  SupplierQuoteSnapshot,
} from "./supplier-negotiation-types";

export type {
  CounterNegotiationDisplay,
  LastPurchasePrice,
  SupplierQuoteSnapshot,
} from "./supplier-negotiation-types";

type QuoteLike = {
  id: string;
  unitPrice: { toString(): string };
  currencyCode: string | null;
  kind: string;
  createdAt: Date;
  supersedesQuote?: {
    id: string;
    unitPrice: { toString(): string };
    currencyCode: string | null;
    kind: string;
    createdAt: Date;
  } | null;
};

/**
 * Build display fields for a COUNTER_PENDING agreement.
 * Pure mapping — callers supply supplier-scoped quote + purchase rows.
 */
export function buildCounterNegotiationDisplay(args: {
  currentQuote: QuoteLike;
  currencyCodeFallback?: string | null;
  lastPurchase: LastPurchasePrice | null;
  previousQuotedPrice: SupplierQuoteSnapshot | null;
}): CounterNegotiationDisplay {
  const currency =
    args.currentQuote.currencyCode ??
    args.currencyCodeFallback ??
    "LKR";
  const prior = args.currentQuote.supersedesQuote;
  const currentSupplierQuote: SupplierQuoteSnapshot | null = prior
    ? {
        unitPrice: prior.unitPrice.toString(),
        currencyCode: prior.currencyCode ?? currency,
        kind: prior.kind,
        createdAt: prior.createdAt,
        createdAtLabel: formatDateTime(prior.createdAt),
      }
    : null;

  return {
    companyCounterPrice: args.currentQuote.unitPrice.toString(),
    currencyCode: currency,
    currentSupplierQuote,
    previousQuotedPrice: args.previousQuotedPrice,
    lastPurchase: args.lastPurchase,
  };
}

/** Last actual purchased unit price for this supplier + company + product. */
export async function loadLastPurchaseForSupplierProduct(args: {
  companyId: string;
  supplierId: string;
  productId: string;
}): Promise<LastPurchasePrice | null> {
  const row = await prisma.orderItem.findFirst({
    where: {
      companyId: args.companyId,
      supplierId: args.supplierId,
      productId: args.productId,
      unitPrice: { not: null },
      purchaseOrder: {
        companyId: args.companyId,
        supplierId: args.supplierId,
        status: {
          in: ["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED"],
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      unitPrice: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          orderNumber: true,
          confirmedAt: true,
          currencyCode: true,
        },
      },
    },
  });

  if (!row?.unitPrice) return null;
  const purchasedAt = row.purchaseOrder.confirmedAt ?? row.createdAt;
  return {
    unitPrice: row.unitPrice.toString(),
    currencyCode: row.purchaseOrder.currencyCode ?? "LKR",
    purchasedAt,
    purchasedAtLabel: row.purchaseOrder.confirmedAt
      ? formatCalendarDate(row.purchaseOrder.confirmedAt)
      : formatDateTime(row.createdAt),
    orderNumber: row.purchaseOrder.orderNumber,
  };
}

/**
 * Batch last-purchase lookup for many products (same supplier session scope).
 * Never crosses company/supplier boundaries.
 */
export async function loadLastPurchasesForSupplierProducts(args: {
  companyId: string;
  supplierId: string;
  productIds: string[];
}): Promise<Map<string, LastPurchasePrice>> {
  const unique = [...new Set(args.productIds.filter(Boolean))];
  const result = new Map<string, LastPurchasePrice>();
  if (unique.length === 0) return result;

  const rows = await prisma.orderItem.findMany({
    where: {
      companyId: args.companyId,
      supplierId: args.supplierId,
      productId: { in: unique },
      unitPrice: { not: null },
      purchaseOrder: {
        companyId: args.companyId,
        supplierId: args.supplierId,
        status: {
          in: ["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED"],
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      productId: true,
      unitPrice: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          orderNumber: true,
          confirmedAt: true,
          currencyCode: true,
        },
      },
    },
  });

  for (const row of rows) {
    if (result.has(row.productId) || !row.unitPrice) continue;
    const purchasedAt = row.purchaseOrder.confirmedAt ?? row.createdAt;
    result.set(row.productId, {
      unitPrice: row.unitPrice.toString(),
      currencyCode: row.purchaseOrder.currencyCode ?? "LKR",
      purchasedAt,
      purchasedAtLabel: row.purchaseOrder.confirmedAt
        ? formatCalendarDate(row.purchaseOrder.confirmedAt)
        : formatDateTime(row.createdAt),
      orderNumber: row.purchaseOrder.orderNumber,
    });
  }

  return result;
}

/**
 * Optional older supplier quote for the same product (outside excluded quote ids).
 * Scoped to session company + supplier only.
 */
export async function loadPreviousSupplierQuotedPrice(args: {
  companyId: string;
  supplierId: string;
  productId: string;
  excludeQuoteIds: string[];
  excludeOfferId?: string | null;
}): Promise<SupplierQuoteSnapshot | null> {
  const row = await prisma.priceQuote.findFirst({
    where: {
      companyId: args.companyId,
      supplierId: args.supplierId,
      productId: args.productId,
      kind: { in: ["SUPPLIER_ORIGINAL", "SUPPLIER_REVISED"] },
      ...(args.excludeQuoteIds.length
        ? { id: { notIn: args.excludeQuoteIds } }
        : {}),
      ...(args.excludeOfferId
        ? {
            OR: [
              { availabilityOfferId: null },
              { availabilityOfferId: { not: args.excludeOfferId } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      unitPrice: true,
      currencyCode: true,
      kind: true,
      createdAt: true,
    },
  });

  if (!row) return null;
  return {
    unitPrice: row.unitPrice.toString(),
    currencyCode: row.currencyCode ?? "LKR",
    kind: row.kind,
    createdAt: row.createdAt,
    createdAtLabel: formatDateTime(row.createdAt),
  };
}
