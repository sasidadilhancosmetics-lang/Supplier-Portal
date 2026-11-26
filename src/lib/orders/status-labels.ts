import type { PurchaseOrderStatus } from "@/generated/prisma/client";

/** Staff-facing purchase order status labels. */
export function staffPurchaseOrderStatusLabel(
  status: PurchaseOrderStatus,
): string {
  switch (status) {
    case "SENT":
      return "Awaiting Supplier Confirmation";
    case "CONFIRMED":
      return "Confirmed";
    case "DRAFT":
      return "Draft";
    case "PARTIALLY_DELIVERED":
      return "Partially delivered";
    case "PARTIALLY_CANCELLED":
      return "Partially cancelled";
    case "DELIVERED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

/** Supplier-facing purchase order status labels. */
export function supplierPurchaseOrderStatusLabel(
  status: PurchaseOrderStatus,
): string {
  switch (status) {
    case "SENT":
      return "Awaiting your confirmation";
    case "CONFIRMED":
      return "Confirmed";
    case "CANCELLED":
      return "Cancelled";
    case "PARTIALLY_CANCELLED":
      return "Partially cancelled";
    default:
      return staffPurchaseOrderStatusLabel(status);
  }
}

export function canSupplierCancelOrder(status: PurchaseOrderStatus): boolean {
  return status === "SENT" || status === "CONFIRMED";
}
