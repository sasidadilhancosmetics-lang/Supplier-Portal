import { Badge } from "@/components/ui/badge";
import type { ProductMasterStatus } from "@/generated/prisma/client";

export function ProductMasterBadge({
  status,
}: {
  status: ProductMasterStatus;
}) {
  return (
    <Badge variant={status === "ERP_LINKED" ? "default" : "outline"}>
      {status === "ERP_LINKED" ? "ERP linked" : "Provisional"}
    </Badge>
  );
}
