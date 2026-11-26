import type {
  OsfImportLineMappingStatus,
  OsfImportStatus,
  Prisma,
} from "@/generated/prisma/client";

import { osfImportReviewPath } from "./constants";
import { COSMO_OSF_CONTRACT_VERSION } from "./constants";

export type CosmoIngestSuccessResponse = {
  contractVersion: typeof COSMO_OSF_CONTRACT_VERSION;
  importId: string;
  status: OsfImportStatus;
  idempotencyKey: string;
  replay: boolean;
  summary: {
    brandCount: number;
    lineCount: number;
    matchedCount: number;
    unresolvedCount: number;
    rejectedCount: number;
    totalQuantityProposed: number;
  };
  requirements: Array<{
    requirementId: string;
    brandId: string;
    brandName: string;
    status: "DRAFT" | "CONFIRMED" | "CANCELLED";
    itemCount: number;
  }>;
  deepLinkPath: string;
};

const UNRESOLVED: OsfImportLineMappingStatus[] = [
  "UNKNOWN_SKU",
  "AMBIGUOUS_SKU",
  "UNKNOWN_BRAND",
  "REJECTED_INVALID_QTY",
];

const REJECTED: OsfImportLineMappingStatus[] = [
  "REJECTED_ZERO_QTY",
  "REJECTED_INVALID_QTY",
  "EXCLUDED",
];

export function buildIngestSuccessResponse(args: {
  importId: string;
  status: OsfImportStatus;
  idempotencyKey: string;
  replay: boolean;
  lines: Array<{
    mappingStatus: OsfImportLineMappingStatus;
    quantityProposed: Prisma.Decimal | number | string;
    brandId: string | null;
    brandNameSnapshot?: string | null;
  }>;
  requirements: Array<{
    id: string;
    brandId: string;
    brandName: string;
    status: "DRAFT" | "CONFIRMED" | "CANCELLED";
    itemCount: number;
  }>;
}): CosmoIngestSuccessResponse {
  const brandKeys = new Set<string>();
  let matchedCount = 0;
  let unresolvedCount = 0;
  let rejectedCount = 0;
  let totalQuantityProposed = 0;

  for (const line of args.lines) {
    const qty = Number(line.quantityProposed);
    totalQuantityProposed += qty;
    if (line.mappingStatus === "MATCHED_SKU") matchedCount++;
    if (UNRESOLVED.includes(line.mappingStatus)) unresolvedCount++;
    if (REJECTED.includes(line.mappingStatus)) rejectedCount++;
    brandKeys.add(line.brandId ?? `name:${line.brandNameSnapshot ?? ""}`);
  }

  return {
    contractVersion: COSMO_OSF_CONTRACT_VERSION,
    importId: args.importId,
    status: args.status,
    idempotencyKey: args.idempotencyKey,
    replay: args.replay,
    summary: {
      brandCount: brandKeys.size,
      lineCount: args.lines.length,
      matchedCount,
      unresolvedCount,
      rejectedCount,
      totalQuantityProposed,
    },
    requirements: args.requirements.map((r) => ({
      requirementId: r.id,
      brandId: r.brandId,
      brandName: r.brandName,
      status: r.status,
      itemCount: r.itemCount,
    })),
    deepLinkPath: osfImportReviewPath(args.importId),
  };
}
