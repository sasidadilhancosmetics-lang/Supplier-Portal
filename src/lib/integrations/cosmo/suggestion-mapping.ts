import type {
  OsfRequestSuggestionMappingStatus,
  Prisma,
} from "@/generated/prisma/client";

import {
  supplierMatchesBrand,
  type MatchableSupplier,
} from "@/lib/requests/matching";

import type { MappedLine } from "./mapping";

/** Inbound suggestion fields needed for mapping (Zod output or test fixtures). */
export type SuggestionMappingInput = {
  lineKey: string;
  cosmoSupplierId: string;
  cosmoSupplierCode?: string | null;
  cosmoSupplierName: string;
  suggestedRequestQty: number;
};

export type ResolvedSuggestionSupplier = MatchableSupplier & {
  externalId: string;
};

export type MappedRequestSuggestion = {
  lineKey: string;
  cosmoSupplierId: string;
  cosmoSupplierCode: string | null;
  cosmoSupplierName: string;
  suggestedRequestQty: number;
  supplierId: string | null;
  mappingStatus: OsfRequestSuggestionMappingStatus;
  sourceSnapshot: {
    lineKey: string;
    cosmoSupplierId: string;
    cosmoSupplierCode: string | null;
    cosmoSupplierName: string;
    suggestedRequestQty: number;
  };
  warningFlags: { overLineQty: true } | null;
};

export type SuggestionLineContext = {
  mappingStatus: MappedLine["mappingStatus"];
  quantityPlanned: number;
  brandId: string | null;
};

/** Line can receive a sendable availability request after confirm+distribute. */
export function isSuggestionLineActionable(
  line: SuggestionLineContext,
): boolean {
  return line.mappingStatus === "MATCHED_SKU" && line.quantityPlanned > 0;
}

/**
 * Derive Portal supplierId + mappingStatus for one suggestion against a line.
 * Lookup must already be company-scoped by externalId — never by name.
 */
export function deriveSuggestionMapping(args: {
  line: SuggestionLineContext;
  supplier: ResolvedSuggestionSupplier | null;
}): {
  mappingStatus: OsfRequestSuggestionMappingStatus;
  supplierId: string | null;
} {
  const { line, supplier } = args;

  if (!isSuggestionLineActionable(line)) {
    return {
      mappingStatus: "LINE_NOT_ACTIONABLE",
      // Preserve resolved supplier id when known (CHECK allows either).
      supplierId: supplier?.id ?? null,
    };
  }
  if (!supplier) {
    return { mappingStatus: "UNRESOLVED_SUPPLIER", supplierId: null };
  }
  if (line.brandId != null && supplierMatchesBrand(supplier, line.brandId)) {
    return { mappingStatus: "MATCHED_SUPPLIER", supplierId: supplier.id };
  }
  return { mappingStatus: "INELIGIBLE_BRAND", supplierId: supplier.id };
}

/**
 * Map Cosmo requestSuggestions onto Portal suppliers.
 * Lookup is company-scoped `Supplier.externalId = cosmoSupplierId` only.
 * Never creates/updates Supplier rows. Never creates SupplierRequest/PO.
 */
export function mapRequestSuggestions(args: {
  suggestions: SuggestionMappingInput[];
  mappedLines: MappedLine[];
  suppliersByExternalId: Map<string, ResolvedSuggestionSupplier>;
}): MappedRequestSuggestion[] {
  const lineByKey = new Map(args.mappedLines.map((l) => [l.lineKey, l]));

  const sumByLineKey = new Map<string, number>();
  for (const suggestion of args.suggestions) {
    sumByLineKey.set(
      suggestion.lineKey,
      (sumByLineKey.get(suggestion.lineKey) ?? 0) +
        suggestion.suggestedRequestQty,
    );
  }

  return args.suggestions.map((suggestion) => {
    const line = lineByKey.get(suggestion.lineKey);
    if (!line) {
      // parseCosmoOsfPushPayload already rejects unknown lineKeys.
      throw new Error(
        `Internal: suggestion lineKey ${suggestion.lineKey} missing from mapped lines`,
      );
    }

    const overLine =
      (sumByLineKey.get(suggestion.lineKey) ?? 0) > line.quantityProposed;
    const supplier =
      args.suppliersByExternalId.get(suggestion.cosmoSupplierId) ?? null;
    const derived = deriveSuggestionMapping({ line, supplier });

    return {
      lineKey: suggestion.lineKey,
      cosmoSupplierId: suggestion.cosmoSupplierId,
      cosmoSupplierCode: suggestion.cosmoSupplierCode ?? null,
      cosmoSupplierName: suggestion.cosmoSupplierName,
      suggestedRequestQty: suggestion.suggestedRequestQty,
      supplierId: derived.supplierId,
      mappingStatus: derived.mappingStatus,
      sourceSnapshot: {
        lineKey: suggestion.lineKey,
        cosmoSupplierId: suggestion.cosmoSupplierId,
        cosmoSupplierCode: suggestion.cosmoSupplierCode ?? null,
        cosmoSupplierName: suggestion.cosmoSupplierName,
        suggestedRequestQty: suggestion.suggestedRequestQty,
      },
      warningFlags: overLine ? { overLineQty: true } : null,
    };
  });
}

export async function loadSuggestionSupplierLookups(
  tx: Prisma.TransactionClient,
  args: { companyId: string; cosmoSupplierIds: string[] },
): Promise<Map<string, ResolvedSuggestionSupplier>> {
  const ids = [...new Set(args.cosmoSupplierIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await tx.supplier.findMany({
    where: {
      companyId: args.companyId,
      externalId: { in: ids },
    },
    select: {
      id: true,
      status: true,
      supportsAllBrands: true,
      externalId: true,
      brands: { select: { brandId: true } },
    },
  });

  const map = new Map<string, ResolvedSuggestionSupplier>();
  for (const row of rows) {
    if (row.externalId == null) continue;
    map.set(row.externalId, {
      id: row.id,
      status: row.status,
      supportsAllBrands: row.supportsAllBrands,
      brandIds: row.brands.map((b) => b.brandId),
      externalId: row.externalId,
    });
  }
  return map;
}
