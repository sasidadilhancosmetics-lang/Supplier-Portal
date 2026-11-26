import "server-only";

import type { RequirementStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { requireRequirementReadAccess } from "./access";
import { REQUIREMENT_PAGE_SIZE } from "./constants";
import { RequirementDomainError } from "./errors";
import { requirementListQuerySchema } from "./schema";

export async function listRequirements(rawQuery: {
  q?: string;
  status?: string;
  brandId?: string;
  page?: string | number;
}) {
  const user = await requireRequirementReadAccess();
  return listRequirementsForUser(user.companyId, rawQuery);
}

/** Company-scoped list after auth (shared by page loader). */
export async function listRequirementsForUser(
  companyId: string,
  rawQuery: {
    q?: string;
    status?: string;
    brandId?: string;
    page?: string | number;
  },
) {
  const parsed = requirementListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new RequirementDomainError("VALIDATION", "Invalid list filters.");
  }

  const { q, status, brandId, page } = parsed.data;
  const where: Prisma.RequirementWhereInput = {
    companyId,
  };
  if (status) where.status = status;
  if (brandId) where.brandId = brandId;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { id: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.requirement.count({ where }),
    prisma.requirement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * REQUIREMENT_PAGE_SIZE,
      take: REQUIREMENT_PAGE_SIZE,
      include: {
        brand: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as RequirementStatus,
      brand: row.brand,
      itemCount: row._count.items,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt,
    })),
    total,
    page,
    pageSize: REQUIREMENT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / REQUIREMENT_PAGE_SIZE)),
    q,
    status: status ?? null,
    brandId: brandId ?? null,
  };
}

/**
 * Requirements index: one auth check, then list + brand filter options.
 * Avoids Promise.all of two separately gated loaders (permission mismatch
 * previously turned CONFIRM/SEND readers into a blank error page).
 */
export async function loadRequirementsIndexPage(rawQuery: {
  q?: string;
  status?: string;
  brandId?: string;
  page?: string | number;
}) {
  const user = await requireRequirementReadAccess();
  const [result, brands] = await Promise.all([
    listRequirementsForUser(user.companyId, rawQuery),
    prisma.brand.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { result, brands };
}

export async function getRequirement(requirementId: string) {
  const user = await requireRequirementReadAccess();
  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, companyId: user.companyId },
    include: {
      brand: { select: { id: true, name: true } },
      confirmedBy: { select: { id: true, email: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              erpItemId: true,
              priorityStatus: true,
              masterStatus: true,
              unitOfMeasure: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!requirement) {
    throw new RequirementDomainError("NOT_FOUND", "Requirement not found.");
  }

  return requirement;
}

/** Active products for a brand — used when adding draft items. */
export async function listActiveProductsForBrand(brandId: string) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, companyId: user.companyId },
    select: { id: true },
  });
  if (!brand) {
    throw new RequirementDomainError("INVALID_BRAND", "Brand is invalid.");
  }

  return prisma.product.findMany({
    where: {
      companyId: user.companyId,
      brandId,
      isActive: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      erpItemId: true,
      priorityStatus: true,
      masterStatus: true,
      unitOfMeasure: true,
    },
  });
}
