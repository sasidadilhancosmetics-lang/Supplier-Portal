import type { PurchaseOrderStatus } from "@/generated/prisma/client";

export type SupplierOrderNextAction = {
  label: string;
  href: string;
};

/**
 * Pure UI helper: next valid supplier action for a PO row.
 * Does not change order state — labels only.
 */
export function resolveSupplierOrderNextAction(args: {
  id: string;
  status: PurchaseOrderStatus;
  /** Remaining schedule capacity > 0 and PO is in a deliverable status. */
  canSchedule: boolean;
  /** Active SUBMITTED or SCHEDULED deliveries exist. */
  hasActiveSchedule: boolean;
}): SupplierOrderNextAction {
  const orderHref = `/supplier/orders/${args.id}`;
  const scheduleHref = `/supplier/orders/${args.id}/deliver`;

  switch (args.status) {
    case "SENT":
      return { label: "Review & Confirm", href: orderHref };
    case "CONFIRMED":
    case "PARTIALLY_CANCELLED":
      if (args.canSchedule) {
        return { label: "Schedule Delivery", href: scheduleHref };
      }
      if (args.hasActiveSchedule) {
        return { label: "View Delivery Schedule", href: scheduleHref };
      }
      return { label: "View Order", href: orderHref };
    case "PARTIALLY_DELIVERED":
      if (args.canSchedule) {
        return { label: "Schedule Remaining", href: scheduleHref };
      }
      if (args.hasActiveSchedule) {
        return { label: "View Delivery Schedule", href: scheduleHref };
      }
      return { label: "View Order", href: orderHref };
    case "DELIVERED":
    case "CANCELLED":
      return { label: "View Details", href: orderHref };
    case "DRAFT":
    default:
      return { label: "View Order", href: orderHref };
  }
}
