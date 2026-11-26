import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  deriveSuggestionMapping,
  loadSuggestionSupplierLookups,
} from "@/lib/integrations/cosmo/suggestion-mapping";

/**
 * Re-evaluate OsfRequestSuggestion rows for the given Cosmo supplier ids.
 * Updates only derived supplierId / mappingStatus. Never mutates Cosmo source
 * fields, quantities, warningFlags, requirements, or SupplierRequests.
 */
export async function remapOsfRequestSuggestionsForCosmoIds(
  tx: Prisma.TransactionClient,
  args: { companyId: string; cosmoSupplierIds: string[] },
): Promise<{ updated: number }> {
  const cosmoIds = [...new Set(args.cosmoSupplierIds.filter(Boolean))];
  if (cosmoIds.length === 0) return { updated: 0 };

  const suggestions = await tx.osfRequestSuggestion.findMany({
    where: {
      companyId: args.companyId,
      cosmoSupplierId: { in: cosmoIds },
    },
    select: {
      id: true,
      cosmoSupplierId: true,
      osfImportLineId: true,
      supplierId: true,
      mappingStatus: true,
    },
  });
  if (suggestions.length === 0) return { updated: 0 };

  const lineIds = [...new Set(suggestions.map((s) => s.osfImportLineId))];
  const lines = await tx.osfImportLine.findMany({
    where: { id: { in: lineIds }, companyId: args.companyId },
    select: {
      id: true,
      mappingStatus: true,
      quantityPlanned: true,
      brandId: true,
    },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const suppliersByExternalId = await loadSuggestionSupplierLookups(tx, {
    companyId: args.companyId,
    cosmoSupplierIds: cosmoIds,
  });

  let updated = 0;
  for (const suggestion of suggestions) {
    const line = lineById.get(suggestion.osfImportLineId);
    if (!line) continue;

    const derived = deriveSuggestionMapping({
      line: {
        mappingStatus: line.mappingStatus,
        quantityPlanned: Number(line.quantityPlanned),
        brandId: line.brandId,
      },
      supplier:
        suppliersByExternalId.get(suggestion.cosmoSupplierId) ?? null,
    });

    if (
      derived.mappingStatus === suggestion.mappingStatus &&
      derived.supplierId === suggestion.supplierId
    ) {
      continue;
    }

    await tx.osfRequestSuggestion.update({
      where: { id: suggestion.id },
      data: {
        mappingStatus: derived.mappingStatus,
        supplierId: derived.supplierId,
      },
    });
    updated++;
  }

  return { updated };
}
