import "server-only";

import { requireAdmin } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { lockSuppliers } from "@/lib/suppliers/locking";

export async function searchCatalogueExclusions(supplierId: string, search: string) {
  const admin = await requireAdmin();
  const scope = { companyId: admin.companyId, supplierId };
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId: admin.companyId }, select: { id: true } });
  if (!supplier) return [];
  const products = await prisma.product.findMany({
    where: {
      companyId: admin.companyId,
      ...(search ? {
        OR: [{ sku: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }],
      } : {
        OR: [
          { catalogueExclusions: { some: scope } },
          { catalogueMedia: { is: { status: "NEEDS_REVIEW" } } },
        ],
      }),
    },
    select: {
      id: true, name: true, sku: true,
      catalogueExclusions: { where: scope, select: { productId: true } },
      catalogueMedia: { select: { status: true, refreshFailedAt: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }], take: 26,
  });
  return products.map(({ catalogueExclusions, catalogueMedia, ...product }) => ({
    ...product, hidden: catalogueExclusions.length > 0,
    photoStatus: catalogueMedia?.status ?? null, photoStale: !!catalogueMedia?.refreshFailedAt,
  }));
}

export async function setCatalogueExclusion(supplierId: string, productId: string, hide: boolean) {
  const admin = await requireAdmin();
  const scope = { companyId: admin.companyId, supplierId, productId };
  return prisma.$transaction(async (tx) => {
    const locked = await lockSuppliers(tx, admin.companyId, [supplierId]);
    if (!locked.length || !await tx.product.findFirst({ where: { id: productId, companyId: admin.companyId }, select: { id: true } })) {
      return false;
    }
    const changed = hide
      ? await tx.supplierCatalogueSkuExclusion.createMany({ data: { ...scope, createdByUserId: admin.id }, skipDuplicates: true })
      : await tx.supplierCatalogueSkuExclusion.deleteMany({ where: scope });
    if (changed.count) await writeAuditLog({
      tx, actorUserId: admin.id, entityType: "Supplier", entityId: supplierId,
      action: hide ? "CATALOGUE_SKU_EXCLUDED" : "CATALOGUE_SKU_RESTORED",
      afterJson: { companyId: admin.companyId, productId },
    });
    return true;
  });
}
