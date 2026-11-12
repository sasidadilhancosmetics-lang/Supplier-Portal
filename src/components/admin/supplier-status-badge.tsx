import { Badge } from "@/components/ui/badge";
import type { SupplierStatus } from "@/generated/prisma/client";

const labels: Record<SupplierStatus, string> = {
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  REJECTED: "Rejected",
};

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const variant =
    status === "ACTIVE"
      ? "success"
      : status === "REJECTED"
        ? "destructive"
        : status === "PENDING_REVIEW"
          ? "warning"
          : "secondary";

  return <Badge variant={variant}>{labels[status]}</Badge>;
}
