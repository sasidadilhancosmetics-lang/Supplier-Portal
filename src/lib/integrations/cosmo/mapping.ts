import type { OsfImportLineMappingStatus, Prisma } from "@/generated/prisma/client";

import type { CosmoOsfItem } from "./schema";

export type ResolvedBrand = {
  brandId: string;
  brandName: string;
};

export type MappedLine = {
  sourceIndex: number;
  lineKey: string;
  sku: string;
  descriptionSnapshot: string;
  cosmoVendorId: string;
  brandNameSnapshot: string;
  erp1Priority: string | null;
  erp2Priority: string | null;
  quantityProposed: number;
  quantityPlanned: number;
  mappingStatus: OsfImportLineMappingStatus;
  brandId: string | null;
  productId: string | null;
};

/**
 * Pure mapping given preloaded brands (by exact name) and products (by sku).
 *
 * Safety rules (cosmo-osf-push.v1):
 * - Reference provisioning happens in the authenticated ingest transaction before this pure mapper.
 * - Never pick an ambiguous product (0 or >1 candidates → unresolved).
 * - Brand and SKU equality is exact / case-sensitive (no folding).
 * - cosmoVendorId is always preserved on the line for future brand linking;
 *   it is not used as a silent match key until a dedicated mapping exists.
 */
export function mapInboundLines(args: {
  items: CosmoOsfItem[];
  brandsByName: Map<string, ResolvedBrand>;
  /**
   * Active products keyed by exact SKU string (case-sensitive). Values may
   * include products on any brand; brandId is checked after SKU lookup.
   */
  productsBySku: Map<
    string,
    Array<{ id: string; brandId: string; sku: string }>
  >;
}): MappedLine[] {
  return args.items.map((item, sourceIndex) => {
    const qty = item.quantity.totalOrderQty;
    const erp1 = item.priorities?.erp1 ?? null;
    const erp2 = item.priorities?.erp2 ?? null;
    const base = {
      sourceIndex,
      lineKey: item.lineKey,
      sku: item.sku,
      descriptionSnapshot: item.description,
      // Always keep Cosmo vendor identity even when brandId is unresolved.
      cosmoVendorId: item.brand.cosmoVendorId,
      brandNameSnapshot: item.brand.name,
      erp1Priority: erp1,
      erp2Priority: erp2,
      quantityProposed: qty,
      quantityPlanned: qty,
    };

    if (qty === 0) {
      const brand = args.brandsByName.get(item.brand.name) ?? null;
      return {
        ...base,
        mappingStatus: "REJECTED_ZERO_QTY" as const,
        brandId: brand?.brandId ?? null,
        productId: null,
      };
    }

    const brand = args.brandsByName.get(item.brand.name);
    if (!brand) {
      return {
        ...base,
        mappingStatus: "UNKNOWN_BRAND" as const,
        brandId: null,
        productId: null,
      };
    }

    const candidates = args.productsBySku.get(item.sku) ?? [];
    const onBrand = candidates.filter((p) => p.brandId === brand.brandId);

    if (onBrand.length === 0) {
      return {
        ...base,
        mappingStatus: "UNKNOWN_SKU" as const,
        brandId: brand.brandId,
        productId: null,
      };
    }
    if (onBrand.length > 1) {
      return {
        ...base,
        mappingStatus: "AMBIGUOUS_SKU" as const,
        brandId: brand.brandId,
        productId: null,
      };
    }

    return {
      ...base,
      mappingStatus: "MATCHED_SKU" as const,
      brandId: brand.brandId,
      productId: onBrand[0]!.id,
    };
  });
}

export async function loadMappingLookups(
  tx: Prisma.TransactionClient,
  args: { companyId: string; items: CosmoOsfItem[] },
): Promise<{
  brandsByName: Map<string, ResolvedBrand>;
  productsBySku: Map<string, Array<{ id: string; brandId: string; sku: string }>>;
}> {
  const brandNames = [...new Set(args.items.map((i) => i.brand.name))];
  const skus = [...new Set(args.items.map((i) => i.sku))];

  // Exact name match only (Postgres / Prisma equality is case-sensitive here).
  const brands = await tx.brand.findMany({
    where: { companyId: args.companyId, name: { in: brandNames } },
    select: { id: true, name: true },
  });
  const brandsByName = new Map(
    brands.map((b) => [b.name, { brandId: b.id, brandName: b.name }]),
  );

  // Exact SKU match only — do not use mode: "insensitive".
  const products = await tx.product.findMany({
    where: {
      companyId: args.companyId,
      isActive: true,
      sku: { in: skus },
    },
    select: { id: true, brandId: true, sku: true },
  });

  const productsBySku = new Map<
    string,
    Array<{ id: string; brandId: string; sku: string }>
  >();
  for (const p of products) {
    if (p.sku == null || p.sku === "") continue;
    // Key must equal the Cosmo sku string exactly (including case).
    const list = productsBySku.get(p.sku) ?? [];
    list.push({ id: p.id, brandId: p.brandId, sku: p.sku });
    productsBySku.set(p.sku, list);
  }

  return { brandsByName, productsBySku };
}

export function deriveImportStatus(
  lines: MappedLine[],
): "NEEDS_REVIEW" | "READY_TO_CONFIRM" {
  const unresolved = lines.some((l) =>
    (
      [
        "UNKNOWN_SKU",
        "AMBIGUOUS_SKU",
        "UNKNOWN_BRAND",
        "REJECTED_INVALID_QTY",
      ] as OsfImportLineMappingStatus[]
    ).includes(l.mappingStatus),
  );
  const matchedPositive = lines.some(
    (l) => l.mappingStatus === "MATCHED_SKU" && l.quantityPlanned > 0,
  );
  if (unresolved || !matchedPositive) return "NEEDS_REVIEW";
  return "READY_TO_CONFIRM";
}
