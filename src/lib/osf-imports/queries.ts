import "server-only";

import { prisma } from "@/lib/db";
import { requireRequirementReadAccess } from "@/lib/requirements/access";

import { OsfImportDomainError } from "./errors";
import { readStockSnapshot } from "./stock-snapshot";
import { isUnresolvedMapping } from "./status";

export type OsfImportReviewLine = {
  id: string;
  sourceIndex: number;
  lineKey: string;
  sku: string;
  descriptionSnapshot: string;
  cosmoVendorId: string | null;
  brandNameSnapshot: string;
  erp1Priority: string | null;
  erp2Priority: string | null;
  totalStock: string | null;
  totalRop: string | null;
  quantityProposed: string;
  quantityPlanned: string;
  mappingStatus: string;
  brandId: string | null;
  productId: string | null;
  productName: string | null;
  requirementId: string | null;
  requirementItemId: string | null;
  resolutionNote: string | null;
  version: number;
  editableQty: boolean;
};

export type OsfImportReviewBrandGroup = {
  brandKey: string;
  brandId: string | null;
  brandName: string;
  cosmoVendorId: string | null;
  brandMapping: "MATCHED" | "UNKNOWN";
  requirementId: string | null;
  requirementStatus: string | null;
  lines: OsfImportReviewLine[];
  issueCount: number;
};

export type OsfImportReviewModel = {
  importId: string;
  status: string;
  version: number;
  idempotencyKey: string;
  contractVersion: string | null;
  receivedAt: string;
  confirmedAt: string | null;
  stockAsOfDate: string | null;
  editable: boolean;
  confirmReady: boolean;
  summary: {
    brandCount: number;
    lineCount: number;
    matchedCount: number;
    unresolvedCount: number;
    rejectedCount: number;
    excludedCount: number;
    totalQuantityProposed: number;
    totalQuantityPlanned: number;
    confirmableRequirementCount: number;
    includedItemCount: number;
    includedQuantityPlanned: number;
    /** F2A read-only Cosmo availability-request suggestion counts. */
    suggestions: {
      total: number;
      matched: number;
      unresolved: number;
      ineligible: number;
      nonActionable: number;
      overLineWarnings: number;
    };
  };
  brands: OsfImportReviewBrandGroup[];
  /** Unresolved Cosmo supplier identities from requestSuggestions (F2B). */
  unresolvedCosmoSuppliers: Array<{
    cosmoSupplierId: string;
    cosmoSupplierCode: string | null;
    cosmoSupplierName: string;
    suggestionCount: number;
    totalSuggestedQty: string;
    mappingStatus: "UNRESOLVED_SUPPLIER";
    lineKeys: string[];
    brandIds: string[];
  }>;
  /** Portal suppliers available for explicit Cosmo mapping (same company). */
  mappableSuppliers: Array<{
    id: string;
    name: string;
    status: string;
    supportsAllBrands: boolean;
    brandIds: string[];
    externalId: string | null;
  }>;
  canManageRequirements: boolean;
  canManageProducts: boolean;
  canManageBrands: boolean;
  canConfirmRequirement: boolean;
  /** ADMIN only — same gate as supplier Cosmo ID edit. */
  canMapCosmoSuppliers: boolean;
};

function brandGroupKey(line: {
  brandId: string | null;
  cosmoVendorId: string | null;
  brandNameSnapshot: string;
}): string {
  if (line.brandId) return `id:${line.brandId}`;
  return `cosmo:${line.cosmoVendorId ?? ""}:${line.brandNameSnapshot}`;
}

export async function getOsfImportReview(
  importId: string,
): Promise<OsfImportReviewModel> {
  const user = await requireRequirementReadAccess();

  const osfImport = await prisma.osfImport.findFirst({
    where: { id: importId, companyId: user.companyId },
    include: {
      lines: {
        include: {
          product: { select: { id: true, name: true } },
        },
        orderBy: [{ brandNameSnapshot: "asc" }, { sourceIndex: "asc" }],
      },
      requirements: {
        select: {
          id: true,
          brandId: true,
          status: true,
        },
      },
      requestSuggestions: {
        select: {
          mappingStatus: true,
          warningFlags: true,
          cosmoSupplierId: true,
          cosmoSupplierCode: true,
          cosmoSupplierName: true,
          suggestedRequestQty: true,
          lineKey: true,
          osfImportLineId: true,
        },
      },
    },
  });

  if (!osfImport) {
    throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
  }

  const stockSnapshot = readStockSnapshot(osfImport.payload);
  const reqByBrand = new Map(
    osfImport.requirements.map((r) => [r.brandId, r]),
  );

  let matchedCount = 0;
  let unresolvedCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  let totalQuantityProposed = 0;
  let totalQuantityPlanned = 0;
  let includedQuantityPlanned = 0;

  const groups = new Map<string, OsfImportReviewBrandGroup>();

  for (const line of osfImport.lines) {
    const qtyProposed = Number(line.quantityProposed);
    const qtyPlanned = Number(line.quantityPlanned);
    totalQuantityProposed += qtyProposed;
    totalQuantityPlanned += qtyPlanned;

    if (line.mappingStatus === "MATCHED_SKU") {
      matchedCount++;
      includedQuantityPlanned += qtyPlanned;
    }
    if (isUnresolvedMapping(line.mappingStatus)) unresolvedCount++;
    if (
      line.mappingStatus === "REJECTED_ZERO_QTY" ||
      line.mappingStatus === "REJECTED_INVALID_QTY"
    ) {
      rejectedCount++;
    }
    if (line.mappingStatus === "EXCLUDED") excludedCount++;

    const key = brandGroupKey(line);
    let group = groups.get(key);
    if (!group) {
      const req = line.brandId ? reqByBrand.get(line.brandId) : undefined;
      group = {
        brandKey: key,
        brandId: line.brandId,
        brandName: line.brandNameSnapshot,
        cosmoVendorId: line.cosmoVendorId,
        brandMapping: line.brandId ? "MATCHED" : "UNKNOWN",
        requirementId: req?.id ?? null,
        requirementStatus: req?.status ?? null,
        lines: [],
        issueCount: 0,
      };
      groups.set(key, group);
    }

    const issue =
      isUnresolvedMapping(line.mappingStatus) ||
      line.mappingStatus === "REJECTED_ZERO_QTY" ||
      line.mappingStatus === "REJECTED_INVALID_QTY";
    if (issue) group.issueCount++;

    const editableQty =
      line.mappingStatus !== "EXCLUDED" &&
      line.mappingStatus !== "REJECTED_ZERO_QTY" &&
      line.mappingStatus !== "REJECTED_INVALID_QTY";

    group.lines.push({
      id: line.id,
      sourceIndex: line.sourceIndex,
      lineKey: line.lineKey,
      sku: line.sku,
      descriptionSnapshot: line.descriptionSnapshot,
      cosmoVendorId: line.cosmoVendorId,
      brandNameSnapshot: line.brandNameSnapshot,
      erp1Priority: line.erp1Priority,
      erp2Priority: line.erp2Priority,
      ...stockSnapshot.forLine(line.sourceIndex, line.lineKey, line.sku),
      quantityProposed: line.quantityProposed.toString(),
      quantityPlanned: line.quantityPlanned.toString(),
      mappingStatus: line.mappingStatus,
      brandId: line.brandId,
      productId: line.productId,
      productName: line.product?.name ?? null,
      requirementId: line.requirementId,
      requirementItemId: line.requirementItemId,
      resolutionNote: line.resolutionNote,
      version: line.version,
      editableQty,
    });
  }

  const { canStaffPermission } = await import("@/lib/auth/guards");
  const [
    canManageRequirements,
    canManageProducts,
    canManageBrands,
    canConfirmRequirement,
  ] = await Promise.all([
    canStaffPermission("MANAGE_REQUIREMENTS"),
    canStaffPermission("MANAGE_PRODUCTS"),
    canStaffPermission("MANAGE_BRANDS"),
    canStaffPermission("CONFIRM_REQUIREMENT"),
  ]);
  const canMapCosmoSuppliers = user.role === "ADMIN";

  const lineBrandById = new Map(
    osfImport.lines.map((l) => [l.id, l.brandId] as const),
  );

  type UnresolvedAgg = {
    cosmoSupplierId: string;
    cosmoSupplierCode: string | null;
    cosmoSupplierName: string;
    suggestionCount: number;
    totalSuggestedQty: number;
    lineKeys: Set<string>;
    brandIds: Set<string>;
  };
  const unresolvedByCosmo = new Map<string, UnresolvedAgg>();
  for (const suggestion of osfImport.requestSuggestions) {
    if (suggestion.mappingStatus !== "UNRESOLVED_SUPPLIER") continue;
    let agg = unresolvedByCosmo.get(suggestion.cosmoSupplierId);
    if (!agg) {
      agg = {
        cosmoSupplierId: suggestion.cosmoSupplierId,
        cosmoSupplierCode: suggestion.cosmoSupplierCode,
        cosmoSupplierName: suggestion.cosmoSupplierName,
        suggestionCount: 0,
        totalSuggestedQty: 0,
        lineKeys: new Set(),
        brandIds: new Set(),
      };
      unresolvedByCosmo.set(suggestion.cosmoSupplierId, agg);
    }
    agg.suggestionCount++;
    agg.totalSuggestedQty += Number(suggestion.suggestedRequestQty);
    agg.lineKeys.add(suggestion.lineKey);
    const brandId = lineBrandById.get(suggestion.osfImportLineId);
    if (brandId) agg.brandIds.add(brandId);
  }

  const unresolvedCosmoSuppliers = [...unresolvedByCosmo.values()]
    .sort((a, b) => a.cosmoSupplierName.localeCompare(b.cosmoSupplierName))
    .map((agg) => ({
      cosmoSupplierId: agg.cosmoSupplierId,
      cosmoSupplierCode: agg.cosmoSupplierCode,
      cosmoSupplierName: agg.cosmoSupplierName,
      suggestionCount: agg.suggestionCount,
      totalSuggestedQty: String(agg.totalSuggestedQty),
      mappingStatus: "UNRESOLVED_SUPPLIER" as const,
      lineKeys: [...agg.lineKeys].sort(),
      brandIds: [...agg.brandIds],
    }));

  const mappableSupplierRows = canMapCosmoSuppliers
    ? await prisma.supplier.findMany({
        where: { companyId: user.companyId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          supportsAllBrands: true,
          externalId: true,
          brands: { select: { brandId: true } },
        },
      })
    : [];
  const mappableSuppliers = mappableSupplierRows.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    supportsAllBrands: s.supportsAllBrands,
    brandIds: s.brands.map((b) => b.brandId),
    externalId: s.externalId,
  }));

  const confirmableRequirements = osfImport.requirements.filter(
    (r) => r.status === "DRAFT",
  ).length;
  const includedItemCount = matchedCount; // matched keepable lines carry items
  const confirmReady =
    osfImport.status === "READY_TO_CONFIRM" &&
    unresolvedCount === 0 &&
    confirmableRequirements > 0;

  const suggestionCounts = {
    total: 0,
    matched: 0,
    unresolved: 0,
    ineligible: 0,
    nonActionable: 0,
    overLineWarnings: 0,
  };
  for (const suggestion of osfImport.requestSuggestions) {
    suggestionCounts.total++;
    switch (suggestion.mappingStatus) {
      case "MATCHED_SUPPLIER":
        suggestionCounts.matched++;
        break;
      case "UNRESOLVED_SUPPLIER":
        suggestionCounts.unresolved++;
        break;
      case "INELIGIBLE_BRAND":
        suggestionCounts.ineligible++;
        break;
      case "LINE_NOT_ACTIONABLE":
        suggestionCounts.nonActionable++;
        break;
      default:
        break;
    }
    const flags = suggestion.warningFlags;
    if (
      flags &&
      typeof flags === "object" &&
      !Array.isArray(flags) &&
      (flags as { overLineQty?: unknown }).overLineQty === true
    ) {
      suggestionCounts.overLineWarnings++;
    }
  }

  return {
    importId: osfImport.id,
    status: osfImport.status,
    version: osfImport.version,
    idempotencyKey: osfImport.idempotencyKey,
    contractVersion: osfImport.contractVersion,
    receivedAt: osfImport.receivedAt.toISOString(),
    confirmedAt: osfImport.confirmedAt?.toISOString() ?? null,
    stockAsOfDate: stockSnapshot.asOfDate,
    editable:
      osfImport.status === "NEEDS_REVIEW" ||
      osfImport.status === "READY_TO_CONFIRM" ||
      osfImport.status === "RECEIVED" ||
      osfImport.status === "PROCESSED",
    summary: {
      brandCount: groups.size,
      lineCount: osfImport.lines.length,
      matchedCount,
      unresolvedCount,
      rejectedCount,
      excludedCount,
      totalQuantityProposed,
      totalQuantityPlanned,
      confirmableRequirementCount: confirmableRequirements,
      includedItemCount,
      includedQuantityPlanned,
      suggestions: suggestionCounts,
    },
    brands: [...groups.values()],
    unresolvedCosmoSuppliers,
    mappableSuppliers,
    canManageRequirements,
    canManageProducts,
    canManageBrands,
    canConfirmRequirement,
    canMapCosmoSuppliers,
    confirmReady,
  };
}

export async function listOsfImportsForCompany() {
  const user = await requireRequirementReadAccess();
  const rows = await prisma.osfImport.findMany({
    where: { companyId: user.companyId },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      idempotencyKey: true,
      receivedAt: true,
      contractVersion: true,
      _count: { select: { lines: true, requirements: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    idempotencyKey: r.idempotencyKey,
    receivedAt: r.receivedAt.toISOString(),
    contractVersion: r.contractVersion,
    lineCount: r._count.lines,
    requirementCount: r._count.requirements,
  }));
}

export async function listProductsForImportBrand(args: {
  brandId: string;
}) {
  const user = await requireRequirementReadAccess();
  return prisma.product.findMany({
    where: {
      companyId: user.companyId,
      brandId: args.brandId,
      isActive: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      brandId: true,
      masterStatus: true,
    },
  });
}

export async function listBrandsForImportResolution() {
  const user = await requireRequirementReadAccess();
  return prisma.brand.findMany({
    where: { companyId: user.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
