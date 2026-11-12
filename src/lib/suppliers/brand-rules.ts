/**
 * Pure brand-membership rules used by admin supplier mutations.
 * Active requests: NEW | PARTIALLY_RESPONDED | RESPONDED.
 */

export function brandsBeingRemoved(
  currentBrandIds: readonly string[],
  nextBrandIds: readonly string[],
): string[] {
  const next = new Set(nextBrandIds);
  return currentBrandIds.filter((id) => !next.has(id));
}

/**
 * Returns brand ids that cannot be removed because they have an active request.
 * When supportsAllBrands remains/turns true, explicit membership removals are still
 * blocked for brands with active requests (membership history must stay).
 */
export function blockedBrandRemovals(args: {
  currentBrandIds: readonly string[];
  nextBrandIds: readonly string[];
  activeRequestBrandIds: readonly string[];
}): string[] {
  const active = new Set(args.activeRequestBrandIds);
  return brandsBeingRemoved(args.currentBrandIds, args.nextBrandIds).filter(
    (id) => active.has(id),
  );
}

/**
 * Turning off Supports All Brands is only allowed when every active-request brand
 * remains covered by an explicit SupplierBrand row.
 */
export function canDisableSupportsAllBrands(args: {
  currentlySupportsAll: boolean;
  nextSupportsAll: boolean;
  nextBrandIds: readonly string[];
  activeRequestBrandIds: readonly string[];
}): boolean {
  if (args.nextSupportsAll || !args.currentlySupportsAll) {
    return true;
  }

  const remaining = new Set(args.nextBrandIds);
  return args.activeRequestBrandIds.every((brandId) => remaining.has(brandId));
}
