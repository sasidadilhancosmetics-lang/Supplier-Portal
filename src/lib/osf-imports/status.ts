import type { OsfImportLineMappingStatus, OsfImportStatus } from "@/generated/prisma/client";

const UNRESOLVED: OsfImportLineMappingStatus[] = [
  "UNKNOWN_SKU",
  "AMBIGUOUS_SKU",
  "UNKNOWN_BRAND",
  "REJECTED_INVALID_QTY",
];

/** Recompute review status from current lines. Never returns CONFIRMED/FAILED. */
export function recomputeImportReviewStatus(
  lines: Array<{
    mappingStatus: OsfImportLineMappingStatus;
    quantityPlanned: { toNumber?: () => number } | number | string;
  }>,
): "NEEDS_REVIEW" | "READY_TO_CONFIRM" {
  const unresolved = lines.some((l) => UNRESOLVED.includes(l.mappingStatus));
  const matchedPositive = lines.some((l) => {
    if (l.mappingStatus !== "MATCHED_SKU") return false;
    const qty =
      typeof l.quantityPlanned === "number"
        ? l.quantityPlanned
        : typeof l.quantityPlanned === "string"
          ? Number(l.quantityPlanned)
          : Number(l.quantityPlanned.toNumber?.() ?? l.quantityPlanned);
    return qty > 0;
  });
  if (unresolved || !matchedPositive) return "NEEDS_REVIEW";
  return "READY_TO_CONFIRM";
}

export function isImportEditableStatus(status: OsfImportStatus): boolean {
  return (
    status === "NEEDS_REVIEW" ||
    status === "READY_TO_CONFIRM" ||
    status === "RECEIVED" ||
    status === "PROCESSED"
  );
}

export function isUnresolvedMapping(
  status: OsfImportLineMappingStatus,
): boolean {
  return UNRESOLVED.includes(status);
}
