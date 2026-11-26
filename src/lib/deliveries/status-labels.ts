import type { DeliveryStatus } from "@/generated/prisma/client";

export type DeliveryFulfillmentLabel =
  | "Awaiting Delivery"
  | "Partially Delivered"
  | "Pending Verification"
  | "Delivered"
  | "Discrepancy / Attention Required";

export function deliveryStatusLabel(status: DeliveryStatus): string {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "SUBMITTED":
      return "Pending verification";
    case "VERIFIED":
      return "Verified receipt";
    case "REJECTED":
      return "Discrepancy flagged";
    case "SUPERSEDED":
      return "Rescheduled (history)";
    default:
      return status;
  }
}

export function fulfillmentLabelForOrder(args: {
  poStatus: string;
  hasPendingVerification: boolean;
  hasScheduledDelivery?: boolean;
  hasRejectedDelivery: boolean;
  hasVerifiedPartial: boolean;
}): DeliveryFulfillmentLabel {
  if (args.hasRejectedDelivery) return "Discrepancy / Attention Required";
  if (args.hasPendingVerification) return "Pending Verification";
  if (args.poStatus === "DELIVERED") return "Delivered";
  if (
    args.poStatus === "PARTIALLY_DELIVERED" ||
    args.hasVerifiedPartial
  ) {
    return "Partially Delivered";
  }
  if (args.hasScheduledDelivery) return "Awaiting Delivery";
  return "Awaiting Delivery";
}

/** Supplier-facing PO delivery status from verified quantities only. */
export function supplierOrderDeliveryLabel(poStatus: string): string {
  if (poStatus === "DELIVERED") return "Delivered";
  if (poStatus === "PARTIALLY_DELIVERED") return "Partially Delivered";
  return "Not yet delivered";
}
