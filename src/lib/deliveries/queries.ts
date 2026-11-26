import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { requireStaffPermission, requireSupplier } from "@/lib/auth/guards";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";

import { DELIVERY_PAGE_SIZE } from "./constants";
import { remainingDeliverable, remainingUnverified } from "./delivery-math";
import { DeliveryDomainError } from "./errors";
import { loadSubmittedDeliveryHolds } from "./holds";
import { deliveryStatusLabel } from "./status-labels";

const deliverablePoStatuses = [
  "CONFIRMED",
  "PARTIALLY_DELIVERED",
  "PARTIALLY_CANCELLED",
] as const;

export async function getSupplierOrderForDelivery(purchaseOrderId: string) {
  const user = await requireSupplier();
  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      companyId: user.companyId,
      supplierId: user.supplierId!,
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, unitOfMeasure: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      deliveries: {
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          grn: { select: { id: true, grnNumber: true, issuedAt: true } },
        },
      },
    },
  });
  if (!po) {
    throw new DeliveryDomainError("NOT_FOUND", "Purchase order not found.");
  }

  const holds = await loadSubmittedDeliveryHolds(
    prisma as never,
    po.items.map((i) => i.id),
  );

  const lines = po.items.map((item) => {
    const remaining = remainingDeliverable({
      quantityOrdered: item.quantityOrdered,
      quantityCancelled: item.quantityCancelled,
      quantityVerifiedReceived: item.quantityVerifiedReceived,
      submittedHold: holds.get(item.id) ?? 0,
    });
    return {
      orderItemId: item.id,
      productName: item.product.name,
      productSku: item.product.sku,
      unitOfMeasure: item.product.unitOfMeasure,
      quantityOrdered: item.quantityOrdered.toString(),
      quantityCancelled: item.quantityCancelled.toString(),
      quantityVerifiedReceived: item.quantityVerifiedReceived.toString(),
      submittedHold: (holds.get(item.id) ?? 0).toString(),
      remainingDeliverable: remaining.toString(),
      expectedDeliveryLabel: formatCalendarDate(item.originalExpectedDeliveryAt),
      canSubmit: remaining.greaterThan(0),
    };
  });

  const canSubmitDelivery =
    deliverablePoStatuses.includes(po.status as (typeof deliverablePoStatuses)[number]) &&
    lines.some((l) => l.canSubmit);

  return {
    id: po.id,
    orderNumber: po.orderNumber ?? po.id,
    status: po.status,
    requiresScheduleApproval: po.requiresScheduleApproval,
    canSubmitDelivery,
    lines,
    deliveries: po.deliveries.map((d) => ({
      id: d.id,
      status: d.status,
      statusLabel: po.requiresScheduleApproval && d.status === "SCHEDULED" && !d.scheduleApprovedAt
        ? "Awaiting company approval"
        : deliveryStatusLabel(d.status),
      canReschedule: d.status === "SCHEDULED",
      plannedDeliveryAtLabel: formatCalendarDate(d.plannedDeliveryAt),
      deliveredAtLabel: formatCalendarDate(d.deliveredAt),
      receivedAtLabel: formatCalendarDate(d.receivedAt),
      verifiedAtLabel: formatDateTime(d.verifiedAt),
      notes: d.notes,
      rescheduleReason: d.rescheduleReason,
      grnNumber: d.grn?.grnNumber ?? null,
      href: `/supplier/orders/${po.id}/deliveries/${d.id}`,
      rescheduleHref: `/supplier/orders/${po.id}/deliveries/${d.id}/reschedule`,
      items: d.items.map((i) => ({
        orderItemId: i.orderItemId,
        quantityDelivered: i.quantityDelivered.toString(),
      })),
    })),
  };
}

export async function listSupplierDeliverableOrders() {
  const user = await requireSupplier();
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId: user.companyId,
      supplierId: user.supplierId!,
      status: { in: [...deliverablePoStatuses] },
    },
    orderBy: { confirmedAt: "asc" },
    take: 50,
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
      deliveries: {
        where: { status: { in: ["SUBMITTED", "SCHEDULED"] } },
        select: { id: true, status: true },
      },
    },
  });

  const rows = [];
  for (const po of orders) {
    const holds = await loadSubmittedDeliveryHolds(
      prisma as never,
      po.items.map((i) => i.id),
    );
    let remaining = new Prisma.Decimal(0);
    let earliest: Date | null = null;
    for (const item of po.items) {
      const rem = remainingDeliverable({
        quantityOrdered: item.quantityOrdered,
        quantityCancelled: item.quantityCancelled,
        quantityVerifiedReceived: item.quantityVerifiedReceived,
        submittedHold: holds.get(item.id) ?? 0,
      });
      remaining = remaining.plus(rem);
      if (item.originalExpectedDeliveryAt) {
        if (!earliest || item.originalExpectedDeliveryAt < earliest) {
          earliest = item.originalExpectedDeliveryAt;
        }
      }
    }
    if (remaining.lte(0) && po.deliveries.length === 0) continue;
    rows.push({
      id: po.id,
      orderNumber: po.orderNumber ?? po.id,
      status: po.status,
      remainingDeliverable: remaining.toString(),
      pendingVerificationCount: po.deliveries.filter(
        (d) => d.status === "SUBMITTED",
      ).length,
      scheduledCount: po.deliveries.filter((d) => d.status === "SCHEDULED")
        .length,
      expectedDeliveryLabel: formatCalendarDate(earliest),
      isOverdue: earliest ? earliest < startOfToday : false,
      hrefDeliver: `/supplier/orders/${po.id}/deliver`,
      hrefOrder: `/supplier/orders/${po.id}`,
    });
  }

  return rows;
}

export async function listPendingDeliveriesForStaff() {
  const user = await requireStaffPermission("VERIFY_DELIVERY");
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await prisma.delivery.findMany({
    where: {
      companyId: user.companyId,
      status: { in: ["SUBMITTED", "SCHEDULED"] },
    },
    orderBy: [{ plannedDeliveryAt: "asc" }, { createdAt: "asc" }],
    take: DELIVERY_PAGE_SIZE,
    include: {
      purchaseOrder: {
        select: {
          id: true,
          orderNumber: true,
          requiresScheduleApproval: true,
          supplier: { select: { name: true } },
        },
      },
      items: {
        include: {
          orderItem: {
            include: {
              product: { select: { name: true, sku: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((d) => {
    const planned = d.plannedDeliveryAt ?? d.deliveredAt;
    const needsScheduleApproval = d.purchaseOrder.requiresScheduleApproval &&
      d.status === "SCHEDULED" && !d.scheduleApprovedAt;
    const isOverdue =
      d.status === "SCHEDULED" && planned != null && planned < startOfToday;
    return {
      id: d.id,
      status: d.status,
      statusLabel: needsScheduleApproval ? "Awaiting schedule approval" : deliveryStatusLabel(d.status),
      kind: d.status === "SCHEDULED" ? ("scheduled" as const) : ("legacy" as const),
      orderNumber: d.purchaseOrder.orderNumber ?? d.purchaseOrder.id,
      purchaseOrderId: d.purchaseOrderId,
      supplierId: d.supplierId,
      supplierName: d.purchaseOrder.supplier.name,
      plannedDeliveryAtLabel: formatCalendarDate(d.plannedDeliveryAt),
      deliveredAtLabel: formatCalendarDate(d.deliveredAt),
      submittedAtLabel: formatDateTime(d.createdAt),
      isOverdue,
      itemCount: d.items.length,
      totalSubmitted: d.items
        .reduce(
          (acc, i) => acc.plus(i.quantityDelivered),
          new Prisma.Decimal(0),
        )
        .toString(),
      lines: d.items.map((i) => ({
        productName: i.orderItem.product.name,
        productSku: i.orderItem.product.sku,
        quantityDelivered: i.quantityDelivered.toString(),
      })),
      href: `/staff/deliveries/${d.id}`,
      actionLabel:
        needsScheduleApproval ? "Review schedule" :
          d.status === "SCHEDULED" ? "Record Receipt" : "Verify Delivery",
    };
  });
}

export async function getDeliveryForStaffVerification(deliveryId: string) {
  const user = await requireStaffPermission("VERIFY_DELIVERY");
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, companyId: user.companyId },
    include: {
      purchaseOrder: {
        select: { id: true, orderNumber: true, status: true, requiresScheduleApproval: true },
      },
      verifiedBy: { select: { id: true, email: true } },
      grn: {
        select: {
          id: true,
          grnNumber: true,
          issuedAt: true,
          items: true,
        },
      },
      items: {
        include: {
          orderItem: {
            include: {
              product: {
                select: {
                  name: true,
                  sku: true,
                  unitOfMeasure: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!delivery) {
    throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: delivery.supplierId, companyId: user.companyId },
    select: { id: true, name: true },
  });
  const needsScheduleApproval = delivery.purchaseOrder.requiresScheduleApproval &&
    delivery.status === "SCHEDULED" && !delivery.scheduleApprovedAt;

  return {
    id: delivery.id,
    status: delivery.status,
    statusLabel: needsScheduleApproval ? "Awaiting schedule approval" : deliveryStatusLabel(delivery.status),
    needsScheduleApproval,
    canVerify:
      (delivery.status === "SUBMITTED" || delivery.status === "SCHEDULED") &&
      (!delivery.purchaseOrder.requiresScheduleApproval || !!delivery.scheduleApprovedAt),
    requiresReceivedAt: delivery.status === "SCHEDULED",
    isScheduled: delivery.status === "SCHEDULED",
    orderNumber: delivery.purchaseOrder.orderNumber ?? delivery.purchaseOrder.id,
    purchaseOrderId: delivery.purchaseOrderId,
    purchaseOrderStatus: delivery.purchaseOrder.status,
    supplierName: supplier?.name ?? "Supplier",
    plannedDeliveryAtLabel: formatCalendarDate(delivery.plannedDeliveryAt),
    deliveredAtLabel: formatCalendarDate(delivery.deliveredAt),
    receivedAtLabel: formatCalendarDate(delivery.receivedAt),
    submittedAtLabel: formatDateTime(delivery.createdAt),
    verifiedAtLabel: formatDateTime(delivery.verifiedAt),
    verifiedByEmail: delivery.verifiedBy?.email ?? null,
    notes: delivery.notes,
    rescheduleReason: delivery.rescheduleReason,
    grnNumber: delivery.grn?.grnNumber ?? null,
    lines: delivery.items.map((i) => ({
      deliveryItemId: i.id,
      orderItemId: i.orderItemId,
      productName: i.orderItem.product.name,
      productSku: i.orderItem.product.sku,
      unitOfMeasure: i.orderItem.product.unitOfMeasure,
      quantityOrdered: i.orderItem.quantityOrdered.toString(),
      quantityVerifiedReceived: i.orderItem.quantityVerifiedReceived.toString(),
      remainingUnverified: remainingUnverified({
        quantityOrdered: i.orderItem.quantityOrdered,
        quantityCancelled: i.orderItem.quantityCancelled,
        quantityVerifiedReceived: i.orderItem.quantityVerifiedReceived,
      }).toString(),
      quantitySubmitted: i.quantityDelivered.toString(),
    })),
  };
}

export async function listCompanyDeliveryOverview() {
  const user = await requireStaffPermission("VERIFY_DELIVERY");
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [pendingVerification, rejectedRecent, openOrders] = await Promise.all([
    prisma.delivery.count({
      where: {
        companyId: user.companyId,
        status: { in: ["SUBMITTED", "SCHEDULED"] },
      },
    }),
    prisma.delivery.count({
      where: {
        companyId: user.companyId,
        status: "REJECTED",
        updatedAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ["CONFIRMED", "PARTIALLY_DELIVERED"] },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        supplier: { select: { name: true } },
        items: {
          select: {
            quantityOrdered: true,
            quantityCancelled: true,
            quantityVerifiedReceived: true,
            originalExpectedDeliveryAt: true,
          },
        },
      },
      take: 100,
    }),
  ]);

  let overdue = 0;
  let partial = 0;
  for (const po of openOrders) {
    if (po.status === "PARTIALLY_DELIVERED") partial += 1;
    const earliest = po.items
      .map((i) => i.originalExpectedDeliveryAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const stillOpen = po.items.some((i) =>
      remainingUnverified({
        quantityOrdered: i.quantityOrdered,
        quantityCancelled: i.quantityCancelled,
        quantityVerifiedReceived: i.quantityVerifiedReceived,
      }).greaterThan(0),
    );
    if (stillOpen && earliest && earliest < startOfToday) overdue += 1;
  }

  return {
    pendingVerification,
    rejectedRecent,
    overdue,
    partial,
  };
}
