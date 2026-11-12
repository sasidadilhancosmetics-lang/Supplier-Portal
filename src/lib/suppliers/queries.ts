import "server-only";

import type { SupplierStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { SUPPLIER_PAGE_SIZE } from "./constants";
import { SupplierDomainError } from "./errors";
import { supplierListQuerySchema } from "./schema";

export type SupplierListItem = {
  id: string;
  name: string;
  status: SupplierStatus;
  supportsAllBrands: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: Date;
  brands: { id: string; name: string }[];
};

export async function listSuppliersForAdmin(rawQuery: {
  q?: string;
  status?: string;
  page?: string | number;
}) {
  const admin = await requireAdmin();
  const parsed = supplierListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new SupplierDomainError("VALIDATION", "Invalid list filters.");
  }

  const { q, status, page } = parsed.data;
  const where: Prisma.SupplierWhereInput = {
    companyId: admin.companyId,
  };

  if (status) {
    where.status = status;
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
      { contactPhone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * SUPPLIER_PAGE_SIZE,
      take: SUPPLIER_PAGE_SIZE,
      include: {
        brands: {
          include: { brand: { select: { id: true, name: true } } },
          orderBy: { brand: { name: "asc" } },
        },
      },
    }),
  ]);

  const items: SupplierListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    supportsAllBrands: row.supportsAllBrands,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    createdAt: row.createdAt,
    brands: row.brands.map((membership) => ({
      id: membership.brand.id,
      name: membership.brand.name,
    })),
  }));

  return {
    items,
    total,
    page,
    pageSize: SUPPLIER_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / SUPPLIER_PAGE_SIZE)),
    q,
    status: status ?? null,
  };
}

export async function getSupplierForAdmin(supplierId: string) {
  const admin = await requireAdmin();

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      companyId: admin.companyId,
    },
    include: {
      brands: {
        include: { brand: { select: { id: true, name: true } } },
        orderBy: { brand: { name: "asc" } },
      },
    },
  });

  if (!supplier) {
    throw new SupplierDomainError("NOT_FOUND", "Supplier not found.");
  }

  return {
    id: supplier.id,
    name: supplier.name,
    status: supplier.status,
    registrationSource: supplier.registrationSource,
    rejectionReason: supplier.rejectionReason,
    reviewedAt: supplier.reviewedAt,
    supportsAllBrands: supplier.supportsAllBrands,
    contactName: supplier.contactName,
    contactEmail: supplier.contactEmail,
    contactPhone: supplier.contactPhone,
    addressLine1: supplier.addressLine1,
    addressLine2: supplier.addressLine2,
    city: supplier.city,
    region: supplier.region,
    postalCode: supplier.postalCode,
    country: supplier.country,
    notes: supplier.notes,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    brands: supplier.brands.map((membership) => ({
      id: membership.brand.id,
      name: membership.brand.name,
    })),
  };
}

export async function listBrandsForAdminCompany() {
  const admin = await requireAdmin();
  return prisma.brand.findMany({
    where: { companyId: admin.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
