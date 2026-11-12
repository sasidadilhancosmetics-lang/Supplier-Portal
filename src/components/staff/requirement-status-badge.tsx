import { Badge } from "@/components/ui/badge";
import type { RequirementStatus } from "@/generated/prisma/client";

const labels: Record<RequirementStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export function RequirementStatusBadge({
  status,
}: {
  status: RequirementStatus;
}) {
  const variant =
    status === "CONFIRMED"
      ? "success"
      : status === "CANCELLED"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}
