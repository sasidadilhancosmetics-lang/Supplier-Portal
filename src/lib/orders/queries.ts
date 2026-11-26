import "server-only";

import { Prisma, type PurchaseOrderStatus } from "@/generated/prisma/client";

import { requireStaffPermission, requireSupplier } from "@/lib/auth/guards";
import { formatCalendarDate, parseCalendarDateInput } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { remainingDeliverable } from "@/lib/deliveries/delivery-math";
import { loadSubmittedDeliveryHolds } from "@/lib/deliveries/holds";
import { expireOfferIfNeeded } from "@/lib/requests/availability";
import { readAvailabilitySplits } from "@/lib/requests/availability-splits";
import { resolveSupplierOrderNextAction } from "@/lib/supplier/order-next-action";

import { ORDER_PAGE_SIZE } from "./constants";
import { loadDateAllocations } from "./availability-split-capacity";
import {
  allocationIneligibilityReason,
  isOfferAllocatableNow,
} from "./eligibility";
import { OrderDomainError } from "./errors";
import {
  staffOrderListQuerySchema,
  supplierOrderListQuerySchema,
} from "./schema";

const deliverableListStatuses = new Set<PurchaseOrderStatus>([
  "CONFIRMED",
  "PARTIALLY_DELIVERED",
  "PARTIALLY_CANCELLED",
]);

const orderItemInclude = {
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      unitOfMeasure: true,
    },
  },
  availabilityOffer: {
    select: {
      id: true,
      availableDate: true,
      reserveExpiresAt: true,
      quantityDeclared: true,
      quantityOrderedActive: true,
      status: true,
      requestItem: {
        select: {
          requirementItemId: true,
          requirementItem: {
            select: {
              id: true,
              quantityPlanned: true,
              requirementId: true,
              requirement: {
                select: { id: true, title: true, status: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function getPurchaseOrderForStaff(purchaseOrderId: string) {
  const user = await requireStaffPermission("ALLOCATE_ORDER");
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, companyId: user.companyId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: orderItemInclude,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!po) {
    throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
  }

  const requirementItemIds = [
    ...new Set(
      po.items
        .map((i) => i.availabilityOffer?.requestItem.requirementItemId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const { loadRequirementCoverage } = await import("./coverage");
  const coverageMap = await loadRequirementCoverage(
    // PrismaClient satisfies the query surface used by coverage.
    prisma as never,
    requirementItemIds,
  );

  const coverage = requirementItemIds.map((id) => {
    const c = coverageMap.get(id);
    const item = po.items.find(
      (i) => i.availabilityOffer?.requestItem.requirementItemId === id,
    );
    const req = item?.availabilityOffer?.requestItem.requirementItem;
    return {
      requirementItemId: id,
      requirementId: req?.requirementId ?? null,
      requirementTitle: req?.requirement.title ?? null,
      productName: item?.product.name ?? null,
      quantityPlanned: c?.quantityPlanned.toString() ?? "0",
      netOrdered: c?.netOrdered.toString() ?? "0",
      uncovered: c?.remainingPlan.toString() ?? "0",
    };
  });

  const reRequestRequirements = [
    ...new Map(
      coverage
        .filter((c) => c.requirementId && Number(c.uncovered) > 0)
        .map((c) => [
          c.requirementId!,
          {
            requirementId: c.requirementId!,
            title: c.requirementTitle,
          },
        ]),
    ).values(),
  ];

  return { ...po, coverage, reRequestRequirements };
}

export async function listPurchaseOrdersForStaff(rawQuery: {
  status?: string;
  page?: string | number;
}) {
  const user = await requireStaffPermission("ALLOCATE_ORDER");
  const parsed = staffOrderListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid order list filters.");
  }

  const statusFilter =
    parsed.data.status === "AWAITING_CONFIRMATION"
      ? ("SENT" as PurchaseOrderStatus)
      : parsed.data.status
        ? (parsed.data.status as PurchaseOrderStatus)
        : undefined;

  const where = {
    companyId: user.companyId,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (parsed.data.page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    items: rows,
    total,
    page: parsed.data.page,
    pageSize: ORDER_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE)),
    status: parsed.data.status ?? null,
  };
}

export async function listPurchaseOrdersForSupplier(rawQuery: {
  status?: string;
  page?: string | number;
}) {
  const user = await requireSupplier();
  const parsed = supplierOrderListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new OrderDomainError("VALIDATION", "Invalid order list filters.");
  }

  const baseWhere = {
    companyId: user.companyId,
    supplierId: user.supplierId!,
  };
  const where = {
    ...baseWhere,
    ...(parsed.data.status
      ? { status: parsed.data.status as PurchaseOrderStatus }
      : {}),
  };

  const [total, anyOrderCount, rows] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.count({ where: baseWhere }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (parsed.data.page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
      include: {
        _count: { select: { items: true } },
        items: {
          select: {
            id: true,
            quantityOrdered: true,
            quantityCancelled: true,
            quantityVerifiedReceived: true,
            originalExpectedDeliveryAt: true,
          },
        },
        deliveries: {
          where: { status: { in: ["SUBMITTED", "SCHEDULED"] } },
          select: { id: true, status: true },
        },
      },
    }),
  ]);
  const hasAnyOrders = anyOrderCount > 0;

  const allItemIds = rows.flatMap((po) => po.items.map((i) => i.id));
  const holds = await loadSubmittedDeliveryHolds(prisma as never, allItemIds);

  const items = rows.map((po) => {
    let remaining = new Prisma.Decimal(0);
    let earliest: Date | null = null;
    for (const item of po.items) {
      if (deliverableListStatuses.has(po.status)) {
        remaining = remaining.plus(
          remainingDeliverable({
            quantityOrdered: item.quantityOrdered,
            quantityCancelled: item.quantityCancelled,
            quantityVerifiedReceived: item.quantityVerifiedReceived,
            submittedHold: holds.get(item.id) ?? 0,
          }),
        );
      }
      if (item.originalExpectedDeliveryAt) {
        if (!earliest || item.originalExpectedDeliveryAt < earliest) {
          earliest = item.originalExpectedDeliveryAt;
        }
      }
    }

    const canSchedule =
      deliverableListStatuses.has(po.status) && remaining.greaterThan(0);
    const hasActiveSchedule = po.deliveries.length > 0;
    const nextAction = resolveSupplierOrderNextAction({
      id: po.id,
      status: po.status,
      canSchedule,
      hasActiveSchedule,
    });

    return {
      id: po.id,
      orderNumber: po.orderNumber,
      status: po.status,
      createdAt: po.createdAt,
      confirmedAt: po.confirmedAt,
      _count: po._count,
      itemCount: po._count.items,
      expectedDeliveryLabel: formatCalendarDate(earliest),
      remainingDeliverable: remaining.toString(),
      nextAction,
    };
  });

  return {
    items,
    total,
    hasAnyOrders,
    page: parsed.data.page,
    pageSize: ORDER_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE)),
    status: parsed.data.status ?? null,
  };
}

export async function getPurchaseOrderForSupplier(purchaseOrderId: string) {
  const user = await requireSupplier();
  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      companyId: user.companyId,
      supplierId: user.supplierId!,
    },
    include: {
      items: {
        include: orderItemInclude,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!po) {
    throw new OrderDomainError("NOT_FOUND", "Purchase order not found.");
  }
  return po;
}

export type AllocatableOfferLine = {
  offerId: string;
  productName: string;
  productSku: string | null;
  quantityPlanned: string | null;
  /** Uncovered planned qty after net ordered (all suppliers). */
  remainingPlan: string | null;
  quantityDeclared: string;
  quantityRequested: string;
  splitDate?: string;
  splitQuantity?: string;
  quantityOrderedActive: string;
  availableDate: Date | null;
  reserveExpiresAt: Date | null;
  status: string;
  remainingAllocatable: string;
  agreedUnitPrice: string | null;
  priceAgreementStatus: string | null;
  priceIsAgreed: boolean;
  productId: string;
};

/**
 * Load a supplier request for allocate UI.
 * Lazy-expires reserves, then returns only currently allocatable lines.
 */
export async function listAllocatableOffersForRequest(
  supplierRequestId: string,
) {
  const user = await requireStaffPermission("ALLOCATE_ORDER");
  const request = await prisma.supplierRequest.findFirst({
    where: { id: supplierRequestId, companyId: user.companyId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              priorityStatus: true,
              unitOfMeasure: true,
            },
          },
          availabilityOffer: {
            include: { priceAgreement: true },
          },
          requirementItem: {
            select: { id: true, quantityPlanned: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!request) {
    throw new OrderDomainError("NOT_FOUND", "Supplier request not found.");
  }

  const requirementIds = [
    ...new Set(
      request.items
        .map((i) => i.requirementItem?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { loadRequirementCoverage } = await import("./coverage");
  const coverageMap = await loadRequirementCoverage(
    prisma as never,
    requirementIds,
  );

  const now = new Date();
  const allocatableLines: AllocatableOfferLine[] = [];
  const skipped: { productName: string; reason: string }[] = [];

  for (const item of request.items) {
    const agreement = item.availabilityOffer?.priceAgreement ?? null;
    let offer = item.availabilityOffer;
    if (offer) {
      const expired = await expireOfferIfNeeded(offer.id, offer.supplierId);
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

    if (!offer || !isOfferAllocatableNow(offer, now)) {
      skipped.push({
        productName: item.product.name,
        reason: allocationIneligibilityReason(offer, now) ?? "Not allocatable",
      });
      continue;
    }

    const remaining = Prisma.Decimal.max(0, offer.quantityDeclared.minus(offer.quantityOrderedActive));
    const priceIsAgreed =
      agreement?.status === "SUPPLIER_CONFIRMED" ||
      agreement?.status === "STAFF_ATTESTED_AGREED";

    const reqId = item.requirementItem?.id ?? null;
    const remainingPlan = reqId
      ? (coverageMap.get(reqId)?.remainingPlan.toString() ?? "0")
      : null;

    const line = {
      offerId: offer.id,
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.sku,
      quantityPlanned: item.requirementItem?.quantityPlanned.toString() ?? null,
      remainingPlan,
      quantityDeclared: offer.quantityDeclared.toString(),
      quantityRequested: item.quantityRequested.toString(),
      quantityOrderedActive: offer.quantityOrderedActive.toString(),
      availableDate: offer.availableDate,
      reserveExpiresAt: offer.reserveExpiresAt,
      status: offer.status,
      remainingAllocatable: remaining.toString(),
      agreedUnitPrice: priceIsAgreed
        ? agreement!.unitPrice.toString()
        : null,
      priceAgreementStatus: agreement?.status ?? null,
      priceIsAgreed: Boolean(priceIsAgreed),
    };
    if (offer.availableSplits == null) {
      allocatableLines.push(line);
    } else {
      const allocated = await loadDateAllocations(prisma, offer.id, user.companyId, offer.supplierId);
      for (const split of readAvailabilitySplits(offer.availableSplits)) {
        const capacity = Prisma.Decimal.max(0, Prisma.Decimal.min(remaining,
          new Prisma.Decimal(split.quantity).minus(allocated.get(split.date) ?? 0)));
        if (capacity.greaterThan(0)) allocatableLines.push({
          ...line, splitDate: split.date, splitQuantity: split.quantity,
          availableDate: parseCalendarDateInput(split.date), remainingAllocatable: capacity.toString(),
        });
      }
    }
  }

  return {
    id: request.id,
    supplierId: request.supplierId,
    supplier: request.supplier,
    allocatableLines,
    skipped,
  };
}
