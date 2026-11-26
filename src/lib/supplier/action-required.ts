import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { requireSupplier } from "@/lib/auth/guards";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { remainingDeliverable } from "@/lib/deliveries/delivery-math";
import { loadSubmittedDeliveryHolds } from "@/lib/deliveries/holds";

const APPROACHING_SCHEDULE_DAYS = 7;
const ACTION_LIST_LIMIT = 10;

export type PendingCounterOfferRow = {
  availabilityOfferId: string;
  supplierRequestId: string;
  productName: string;
  productSku: string | null;
  companyCounterPrice: string;
  originalSupplierPrice: string | null;
  currencyCode: string;
  agreementStatus: "COUNTER_PENDING";
  agreementVersion: number;
  counteredAt: Date;
  counteredAtLabel: string;
  href: string;
};

export type PendingAvailabilityRequestRow = {
  id: string;
  brandName: string;
  status: string;
  itemCount: number;
  responseDeadline: Date | null;
  responseDeadlineLabel: string;
  href: string;
};

export type PendingOrderConfirmRow = {
  id: string;
  orderNumber: string;
  itemCount: number;
  expectedDeliveryLabel: string;
  createdAtLabel: string;
  href: string;
};

export type PendingScheduleRow = {
  id: string;
  orderNumber: string;
  remainingDeliverable: string;
  expectedDeliveryLabel: string;
  href: string;
};

export type ApproachingScheduleRow = {
  id: string;
  deliveryId: string;
  orderNumber: string;
  plannedDeliveryLabel: string;
  isOverdue: boolean;
  href: string;
};

/**
 * Supplier-scoped Action Required.
 * Session supplierId/companyId only — never trust client ids.
 * Excludes already-responded requests and completed (fully delivered) orders.
 */
export async function loadSupplierActionRequired() {
  const user = await requireSupplier();
  const companyId = user.companyId;
  const supplierId = user.supplierId!;
  const now = new Date();
  const approachingCutoff = new Date(now);
  approachingCutoff.setUTCDate(
    approachingCutoff.getUTCDate() + APPROACHING_SCHEDULE_DAYS,
  );
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [
    counterAgreements,
    pendingRequests,
    ordersAwaitingConfirm,
    scheduleCandidateOrders,
    approachingDeliveries,
  ] = await Promise.all([
    prisma.priceAgreement.findMany({
      where: {
        companyId,
        supplierId,
        status: "COUNTER_PENDING",
        currentQuote: { kind: "COMPANY_COUNTER" },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        currentQuote: {
          select: {
            unitPrice: true,
            currencyCode: true,
            createdAt: true,
            supersedesQuote: {
              select: { unitPrice: true, kind: true },
            },
          },
        },
        availabilityOffer: {
          select: {
            id: true,
            requestItem: {
              select: {
                supplierRequestId: true,
                product: { select: { name: true, sku: true } },
              },
            },
          },
        },
      },
    }),
    prisma.supplierRequest.findMany({
      where: {
        companyId,
        supplierId,
        status: { in: ["NEW", "PARTIALLY_RESPONDED"] },
      },
      orderBy: [{ responseDeadline: "asc" }, { sentAt: "desc" }],
      take: ACTION_LIST_LIMIT,
      include: {
        brand: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { companyId, supplierId, status: "SENT" },
      orderBy: { createdAt: "desc" },
      take: ACTION_LIST_LIMIT,
      include: {
        _count: { select: { items: true } },
        items: {
          select: { originalExpectedDeliveryAt: true },
          orderBy: { originalExpectedDeliveryAt: "asc" },
          take: 1,
        },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        companyId,
        supplierId,
        status: {
          in: ["CONFIRMED", "PARTIALLY_DELIVERED", "PARTIALLY_CANCELLED"],
        },
      },
      orderBy: { confirmedAt: "asc" },
      take: 40,
      include: {
        items: {
          select: {
            id: true,
            quantityOrdered: true,
            quantityCancelled: true,
            quantityVerifiedReceived: true,
            originalExpectedDeliveryAt: true,
          },
        },
      },
    }),
    prisma.delivery.findMany({
      where: {
        companyId,
        supplierId,
        status: "SCHEDULED",
        plannedDeliveryAt: { not: null, lte: approachingCutoff },
      },
      orderBy: { plannedDeliveryAt: "asc" },
      take: ACTION_LIST_LIMIT,
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true } },
      },
    }),
  ]);

  const pendingCounters: PendingCounterOfferRow[] = counterAgreements.map(
    (row) => {
      const original =
        row.currentQuote.supersedesQuote?.unitPrice?.toString() ?? null;
      const requestId = row.availabilityOffer.requestItem.supplierRequestId;
      return {
        availabilityOfferId: row.availabilityOfferId,
        supplierRequestId: requestId,
        productName: row.availabilityOffer.requestItem.product.name,
        productSku: row.availabilityOffer.requestItem.product.sku,
        companyCounterPrice: row.currentQuote.unitPrice.toString(),
        originalSupplierPrice: original,
        currencyCode: row.currentQuote.currencyCode ?? row.currencyCode ?? "LKR",
        agreementStatus: "COUNTER_PENDING" as const,
        agreementVersion: row.version,
        counteredAt: row.currentQuote.createdAt,
        counteredAtLabel: formatDateTime(row.currentQuote.createdAt),
        href: `/supplier/requests/${requestId}?focus=counter&offer=${row.availabilityOfferId}`,
      };
    },
  );

  const pendingAvailability: PendingAvailabilityRequestRow[] =
    pendingRequests.map((row) => ({
      id: row.id,
      brandName: row.brand.name,
      status: row.status,
      itemCount: row._count.items,
      responseDeadline: row.responseDeadline,
      responseDeadlineLabel: formatDateTime(row.responseDeadline),
      href: `/supplier/requests/${row.id}`,
    }));

  const pendingOrdersToConfirm: PendingOrderConfirmRow[] =
    ordersAwaitingConfirm.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber ?? row.id,
      itemCount: row._count.items,
      expectedDeliveryLabel: formatCalendarDate(
        row.items[0]?.originalExpectedDeliveryAt ?? null,
      ),
      createdAtLabel: formatDateTime(row.createdAt),
      href: `/supplier/orders/${row.id}`,
    }));

  const allScheduleItemIds = scheduleCandidateOrders.flatMap((po) =>
    po.items.map((i) => i.id),
  );
  const scheduleHolds = await loadSubmittedDeliveryHolds(
    prisma as never,
    allScheduleItemIds,
  );

  const ordersNeedingSchedule: PendingScheduleRow[] = [];
  for (const po of scheduleCandidateOrders) {
    let remaining = new Prisma.Decimal(0);
    let earliest: Date | null = null;
    for (const item of po.items) {
      remaining = remaining.plus(
        remainingDeliverable({
          quantityOrdered: item.quantityOrdered,
          quantityCancelled: item.quantityCancelled,
          quantityVerifiedReceived: item.quantityVerifiedReceived,
          submittedHold: scheduleHolds.get(item.id) ?? 0,
        }),
      );
      if (item.originalExpectedDeliveryAt) {
        if (!earliest || item.originalExpectedDeliveryAt < earliest) {
          earliest = item.originalExpectedDeliveryAt;
        }
      }
    }
    if (remaining.lte(0)) continue;
    ordersNeedingSchedule.push({
      id: po.id,
      orderNumber: po.orderNumber ?? po.id,
      remainingDeliverable: remaining.toString(),
      expectedDeliveryLabel: formatCalendarDate(earliest),
      href: `/supplier/orders/${po.id}/deliver`,
    });
    if (ordersNeedingSchedule.length >= ACTION_LIST_LIMIT) break;
  }

  const approachingSchedules: ApproachingScheduleRow[] =
    approachingDeliveries.map((d) => {
      const planned = d.plannedDeliveryAt!;
      return {
        id: d.id,
        deliveryId: d.id,
        orderNumber: d.purchaseOrder.orderNumber ?? d.purchaseOrder.id,
        plannedDeliveryLabel: formatCalendarDate(planned),
        isOverdue: planned < startOfToday,
        href: `/supplier/orders/${d.purchaseOrder.id}/deliver`,
      };
    });

  return {
    pendingCounters,
    pendingAvailability,
    pendingOrdersToConfirm,
    ordersNeedingSchedule,
    approachingSchedules,
    counts: {
      pendingCounters: pendingCounters.length,
      pendingAvailability: pendingAvailability.length,
      pendingOrdersToConfirm: pendingOrdersToConfirm.length,
      ordersNeedingSchedule: ordersNeedingSchedule.length,
      approachingSchedules: approachingSchedules.length,
      actionRequired:
        pendingCounters.length +
        pendingAvailability.length +
        pendingOrdersToConfirm.length +
        ordersNeedingSchedule.length +
        approachingSchedules.length,
    },
  };
}
