import type { PurchaseOrderStatus } from "@/generated/prisma/client";

import { formatDateTime } from "@/lib/dates";
import { supplierPurchaseOrderStatusLabel } from "@/lib/orders/status-labels";

import type { DashboardRecentRow, DashboardStat } from "./queries";

export type SupplierRecentOrderInput = {
  id: string;
  orderNumber: string | null;
  status: PurchaseOrderStatus;
  itemCount: number;
  createdAt: Date;
};

/**
 * Map supplier POs into dashboard Recent Orders rows.
 * Includes every status returned by the supplier order list (including DELIVERED).
 */
export function mapSupplierRecentOrderRows(
  orders: SupplierRecentOrderInput[],
): DashboardRecentRow[] {
  return orders.map((po) => ({
    id: po.id,
    title: po.orderNumber ?? po.id,
    meta: `${supplierPurchaseOrderStatusLabel(po.status)} · ${po.itemCount} item${
      po.itemCount === 1 ? "" : "s"
    } · ${formatDateTime(po.createdAt)}`,
    href: `/supplier/orders/${po.id}`,
  }));
}

/**
 * Availability Summary order counts stay status-specific.
 * Delivered POs must not inflate actionable counters.
 */
export function buildSupplierAvailabilityOrderStats(args: {
  openRequests: number;
  responded: number;
  /** Count of status === SENT only. */
  ordersAwaitingConfirm: number;
  /** Count of CONFIRMED | PARTIALLY_DELIVERED only. */
  confirmedInDelivery: number;
  unreadNotifications?: number;
}): DashboardStat[] {
  const stats: DashboardStat[] = [
    {
      id: "open-req",
      label: "Open requests",
      value: args.openRequests,
      href: "/supplier/requests?status=ACTION_REQUIRED",
    },
    {
      id: "responded",
      label: "Responded",
      value: args.responded,
      href: "/supplier/requests?status=RESPONDED",
    },
    {
      id: "po-sent",
      label: "Orders to confirm",
      value: args.ordersAwaitingConfirm,
      href: "/supplier/orders?status=SENT",
    },
    {
      id: "po-open",
      label: "Confirmed / in delivery",
      value: args.confirmedInDelivery,
      href: "/supplier/orders",
    },
  ];

  if (args.unreadNotifications && args.unreadNotifications > 0) {
    stats.push({
      id: "notifications",
      label: "Unread notifications",
      value: args.unreadNotifications,
      href: "/supplier/notifications",
    });
  }

  return stats;
}
