import type { SupplierRequestStatus } from "@/generated/prisma/client";

/** Active supplier requests that block brand membership changes. */
export const ACTIVE_SUPPLIER_REQUEST_STATUSES = [
  "NEW",
  "PARTIALLY_RESPONDED",
  "RESPONDED",
] as const satisfies readonly SupplierRequestStatus[];

export type ActiveSupplierRequestStatus =
  (typeof ACTIVE_SUPPLIER_REQUEST_STATUSES)[number];

export const SUPPLIER_PAGE_SIZE = 20;
