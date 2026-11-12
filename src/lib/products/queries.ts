import "server-only";

import type {
  ProductMasterStatus,
  ProductPriorityStatus,
} from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { PRODUCT_PAGE_SIZE } from "./constants";
import { ProductDomainError } from "./errors";
import { productListQuerySchema } from "./schema";

export type ProductListItem = {
  id: string;
  name: string;
  sku: string | null;
  erpItemId: string | null;
  cosmoItemId: string | null;
  unitOfMeasure: string | null;
  priorityStatus: ProductPriorityStatus;
  masterStatus: ProductMasterStatus;
  isActive: boolean;
  brand: { id: string; name: string };
  createdAt: Date;
};

export async function listProducts(rawQuery: {
  q?: string;
  brandId?: string;
  masterStatus?: string;
  page?: string | number;
}) {
  const user = await requireStaffPermission("MANAGE_PRODUCTS");
  const parsed = productListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new ProductDomainError("VALIDATION", "Invalid list filters.");
  }

  const { q, brandId, masterStatus, page } = parsed.data;
  const where: Prisma.ProductWhereInput = {
    companyId: user.companyId,
  };

  if (brandId) where.brandId = brandId;
  if (masterStatus) where.masterStatus = masterStatus;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { erpItemId: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PRODUCT_PAGE_SIZE,
      take: PRODUCT_PAGE_SIZE,
      include: {
        brand: { select: { id: true, name: true } },
      },
    }),
  ]);

  const items: ProductListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    erpItemId: row.erpItemId,
    cosmoItemId: row.cosmoItemId,
    unitOfMeasure: row.unitOfMeasure,
    priorityStatus: row.priorityStatus,
    masterStatus: row.masterStatus,
    isActive: row.isActive,
    brand: row.brand,
    createdAt: row.createdAt,
  }));

  return {
    items,
    total,
    page,
    pageSize: PRODUCT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
    q,
    brandId: brandId ?? null,
    masterStatus: masterStatus ?? null,
  };
}

export async function getProduct(productId: string) {
  const user = await requireStaffPermission("MANAGE_PRODUCTS");
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: user.companyId },
    include: { brand: { select: { id: true, name: true } } },
  });
  if (!product) {
    throw new ProductDomainError("NOT_FOUND", "Product not found.");
  }
  return product;
}
