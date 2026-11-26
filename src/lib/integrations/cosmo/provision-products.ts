import type { Prisma } from "@/generated/prisma/client";

import { createId } from "@/lib/id";

import type { CosmoOsfItem } from "./schema";

/** Create or refresh OSF-owned references before mapping lines. The caller holds the company lock. */
export async function provisionOsfProducts(
  tx: Prisma.TransactionClient,
  companyId: string,
  items: CosmoOsfItem[],
): Promise<Set<string>> {
  const vendorsByBrand = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.quantity.totalOrderQty <= 0) continue;
    const vendors = vendorsByBrand.get(item.brand.name) ?? new Set<string>();
    vendors.add(item.brand.cosmoVendorId);
    vendorsByBrand.set(item.brand.name, vendors);
  }
  // The current Brand model has no Cosmo vendor ID. Do not assign a brand name
  // to two different source vendors in the same transfer without review.
  const ambiguousBrands = new Set(
    [...vendorsByBrand].filter(([, vendors]) => vendors.size > 1).map(([name]) => name),
  );
  const names = [...vendorsByBrand.keys()].filter((name) => !ambiguousBrands.has(name));
  const brands = await tx.brand.findMany({
    where: { companyId, name: { in: names } },
    select: { id: true, name: true },
  });
  const brandIds = new Map(brands.map((brand) => [brand.name, brand.id]));
  for (const name of names) {
    if (brandIds.has(name)) continue;
    const brand = await tx.brand.create({
      data: { id: createId(), companyId, name },
      select: { id: true, name: true },
    });
    brandIds.set(brand.name, brand.id);
  }

  const skus = [...new Set(items.filter((item) => item.quantity.totalOrderQty > 0).map((item) => item.sku))];
  const products = await tx.product.findMany({
    where: { companyId, sku: { in: skus } },
    select: { id: true, brandId: true, sku: true, name: true, isActive: true },
  });
  const byBrandSku = new Map<string, typeof products>();
  const key = (brandId: string, sku: string) => JSON.stringify([brandId, sku]);
  for (const product of products) {
    if (!product.sku) continue;
    const productKey = key(product.brandId, product.sku);
    byBrandSku.set(productKey, [...(byBrandSku.get(productKey) ?? []), product]);
  }
  const processed = new Set<string>();
  for (const item of items) {
    if (item.quantity.totalOrderQty <= 0 || ambiguousBrands.has(item.brand.name)) continue;
    const brandId = brandIds.get(item.brand.name);
    if (!brandId) continue;
    const productKey = key(brandId, item.sku);
    if (processed.has(productKey)) continue;
    processed.add(productKey);
    const candidates = byBrandSku.get(productKey) ?? [];
    const name = item.description.trim() || item.sku;
    if (candidates.length === 1 && candidates[0]!.isActive) {
      if (candidates[0]!.name !== name) {
        await tx.product.update({ where: { id: candidates[0]!.id }, data: { name } });
      }
      continue;
    }
    // Inactive or duplicate legacy references need review; do not reactivate or
    // silently choose one. Never create a second reference for the same pair.
    if (candidates.length > 0) continue;
    const product = await tx.product.create({
      data: { id: createId(), companyId, brandId, sku: item.sku, name, isActive: true },
      select: { id: true, brandId: true, sku: true, name: true, isActive: true },
    });
    byBrandSku.set(productKey, [product]);
  }
  return ambiguousBrands;
}
