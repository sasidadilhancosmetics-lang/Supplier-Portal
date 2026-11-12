/**
 * Pure supplier↔brand matching for request distribution.
 * ACTIVE + (supportsAllBrands OR brand membership).
 */

export type MatchableSupplier = {
  id: string;
  status: string;
  supportsAllBrands: boolean;
  brandIds: string[];
};

export function supplierMatchesBrand(
  supplier: MatchableSupplier,
  brandId: string,
): boolean {
  if (supplier.status !== "ACTIVE") {
    return false;
  }
  if (supplier.supportsAllBrands) {
    return true;
  }
  return supplier.brandIds.includes(brandId);
}

export function filterMatchingSuppliers(
  suppliers: MatchableSupplier[],
  brandId: string,
): MatchableSupplier[] {
  return suppliers.filter((supplier) => supplierMatchesBrand(supplier, brandId));
}
