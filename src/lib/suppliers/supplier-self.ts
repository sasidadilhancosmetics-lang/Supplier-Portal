import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { requireSupplier } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { writeSupplierAuditLog } from "./audit";
import {
  blockedBrandRemovals,
  canDisableSupportsAllBrands,
} from "./brand-rules";
import { ACTIVE_SUPPLIER_REQUEST_STATUSES } from "./constants";
import { SupplierDomainError } from "./errors";
import { supplierProfileSchema } from "./schema";

/**
 * Supplier self-service profile update.
 * Derives supplierId from the authenticated user. Cannot change status or companyId.
 */
export async function updateOwnSupplierProfile(raw: unknown) {
  const user = await requireSupplier();
  const supplierId = user.supplierId!;

  const parsed = supplierProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid supplier details.",
    );
  }
  const input = parsed.data;

  const existing = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId: user.companyId },
    include: { brands: { select: { brandId: true } } },
  });
  if (!existing) {
    throw new SupplierDomainError("NOT_FOUND", "Supplier not found.");
  }

  const brandIds = [...new Set(input.brandIds)];
  if (brandIds.length > 0) {
    const count = await prisma.brand.count({
      where: { companyId: user.companyId, id: { in: brandIds } },
    });
    if (count !== brandIds.length) {
      throw new SupplierDomainError(
        "INVALID_BRAND",
        "One or more selected brands are invalid.",
      );
    }
  }

  const currentBrandIds = existing.brands.map((b) => b.brandId);
  const activeRequestBrandIds = (
    await prisma.supplierRequest.findMany({
      where: {
        supplierId,
        status: { in: [...ACTIVE_SUPPLIER_REQUEST_STATUSES] },
      },
      select: { brandId: true },
      distinct: ["brandId"],
    })
  ).map((row) => row.brandId);

  const blocked = blockedBrandRemovals({
    currentBrandIds,
    nextBrandIds: brandIds,
    activeRequestBrandIds,
  });
  if (blocked.length > 0) {
    throw new SupplierDomainError(
      "BRAND_LOCKED",
      "Cannot remove a brand that has an active supplier request.",
    );
  }

  if (
    !canDisableSupportsAllBrands({
      currentlySupportsAll: existing.supportsAllBrands,
      nextSupportsAll: input.supportsAllBrands,
      nextBrandIds: brandIds,
      activeRequestBrandIds,
    })
  ) {
    throw new SupplierDomainError(
      "ALL_BRANDS_LOCKED",
      "Cannot turn off All Brands while active requests exist for brands not still selected.",
    );
  }

  const nullable = (value: string | undefined) => value ?? null;

  await prisma.$transaction(async (tx) => {
    const before = {
      name: existing.name,
      supportsAllBrands: existing.supportsAllBrands,
      brandIds: currentBrandIds,
    } as Prisma.InputJsonValue;

    await tx.supplier.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        supportsAllBrands: input.supportsAllBrands,
        contactName: nullable(input.contactName),
        contactEmail: nullable(input.contactEmail),
        contactPhone: nullable(input.contactPhone),
        addressLine1: nullable(input.addressLine1),
        addressLine2: nullable(input.addressLine2),
        city: nullable(input.city),
        region: nullable(input.region),
        postalCode: nullable(input.postalCode),
        country: nullable(input.country),
        notes: nullable(input.notes),
        // status intentionally unchanged
      },
    });

    const current = new Set(currentBrandIds);
    const next = new Set(brandIds);
    const toRemove = [...current].filter((id) => !next.has(id));
    const toAdd = [...next].filter((id) => !current.has(id));

    if (toRemove.length > 0) {
      await tx.supplierBrand.deleteMany({
        where: { supplierId, brandId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await tx.supplierBrand.createMany({
        data: toAdd.map((brandId) => ({ supplierId, brandId })),
      });
    }

    await writeSupplierAuditLog({
      tx,
      actorUserId: user.id,
      entityId: supplierId,
      action: "UPDATE",
      beforeJson: before,
      afterJson: {
        name: input.name,
        supportsAllBrands: input.supportsAllBrands,
        brandIds,
        event: "SUPPLIER_SELF_PROFILE_UPDATE",
      },
    });
  });

  return { id: supplierId };
}

export async function getOwnSupplierProfile() {
  const user = await requireSupplier();
  const supplier = await prisma.supplier.findFirst({
    where: { id: user.supplierId!, companyId: user.companyId },
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

  const brands = await prisma.brand.findMany({
    where: { companyId: user.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      status: supplier.status,
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
      brandIds: supplier.brands.map((b) => b.brand.id),
    },
    brands,
  };
}
