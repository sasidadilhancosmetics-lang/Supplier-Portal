import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  RECEIVED: "Received",
  PROCESSED: "Processed",
  NEEDS_REVIEW: "Needs review",
  READY_TO_CONFIRM: "Ready to confirm",
  CONFIRMED: "Confirmed",
  FAILED: "Failed",
  MATCHED_SKU: "Matched",
  UNKNOWN_SKU: "Unknown SKU",
  AMBIGUOUS_SKU: "Ambiguous SKU",
  UNKNOWN_BRAND: "Unknown brand",
  REJECTED_ZERO_QTY: "Zero qty",
  REJECTED_INVALID_QTY: "Invalid qty",
  EXCLUDED: "Excluded",
};

export function OsfImportStatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? status;
  const variant =
    status === "READY_TO_CONFIRM" || status === "MATCHED_SKU"
      ? "default"
      : status === "NEEDS_REVIEW" ||
          status === "UNKNOWN_SKU" ||
          status === "AMBIGUOUS_SKU" ||
          status === "UNKNOWN_BRAND"
        ? "secondary"
        : status === "EXCLUDED" ||
            status === "REJECTED_ZERO_QTY" ||
            status === "FAILED"
          ? "outline"
          : "secondary";

  return <Badge variant={variant}>{label}</Badge>;
}
