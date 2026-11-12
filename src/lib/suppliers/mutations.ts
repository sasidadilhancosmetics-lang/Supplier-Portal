import "server-only";

import type { Prisma, SupplierStatus } from "@/generated/prisma/client";

import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { writeSupplierAuditLog } from "./audit";
import {
  blockedBrandRemovals,
  canDisableSupportsAllBrands,
} from "./brand-rules";
import { ACTIVE_SUPPLIER_REQUEST_STATUSES } from "./constants";
import { SupplierDomainError } from "./errors";
import {
  createSupplierSchema,
  supplierStatusChangeSchema,
  updateSupplierSchema,
  type SupplierProfileInput,
} from "./schema";

function profileSnapshot(data: {
  name: string;
  status?: SupplierStatus;
  supportsAllBrands: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  brandIds: string[];
}) {
  return data as Prisma.InputJsonValue;
}

async function assertUniqueSupplierName(
  companyId: string,
  name: string,
  excludeId?: string,
) {
  const existing = await prisma.supplier.findFirst({
    where: {
      companyId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new SupplierDomainError(
      "DUPLICATE_NAME",
      "A supplier with this company name already exists.",
    );
  }
}

async function assertBrandsBelongToCompany(
  companyId: string,
  brandIds: string[],
) {
  if (brandIds.length === 0) {
    return;
  }

  const uniqueIds = [...new Set(brandIds)];
  const count = await prisma.brand.count({
    where: {
      companyId,
      id: { in: uniqueIds },
    },
  });

  if (count !== uniqueIds.length) {
    throw new SupplierDomainError(
      "INVALID_BRAND",
      "One or more selected brands are invalid.",
    );
  }
}

async function loadActiveRequestBrandIds(supplierId: string) {
  const rows = await prisma.supplierRequest.findMany({
    where: {
      supplierId,
      status: { in: [...ACTIVE_SUPPLIER_REQUEST_STATUSES] },
    },
    select: { brandId: true },
    distinct: ["brandId"],
  });
  return rows.map((row) => row.brandId);
}

function nullable(value: string | undefined): string | null {
  return value ?? null;
}

export async function createSupplier(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = createSupplierSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid supplier details.",
    );
  }

  const input = parsed.data;
  await assertUniqueSupplierName(admin.companyId, input.name);
  await assertBrandsBelongToCompany(admin.companyId, input.brandIds);

  const brandIds = [...new Set(input.brandIds)];

  const created = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        companyId: admin.companyId,
        name: input.name,
        status: "PENDING_REVIEW",
        registrationSource: "ADMIN",
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
        brands: {
          create: brandIds.map((brandId) => ({ brandId })),
        },
      },
      include: {
        brands: { select: { brandId: true } },
      },
    });

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: supplier.id,
      action: "CREATE",
      afterJson: profileSnapshot({
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
        brandIds: supplier.brands.map((b) => b.brandId),
      }),
    });

    return supplier;
  });

  return { id: created.id };
}

async function syncBrandMemberships(
  tx: Prisma.TransactionClient,
  supplierId: string,
  currentBrandIds: string[],
  nextBrandIds: string[],
) {
  const current = new Set(currentBrandIds);
  const next = new Set(nextBrandIds);

  const toRemove = [...current].filter((id) => !next.has(id));
  const toAdd = [...next].filter((id) => !current.has(id));

  if (toRemove.length > 0) {
    await tx.supplierBrand.deleteMany({
      where: {
        supplierId,
        brandId: { in: toRemove },
      },
    });
  }

  if (toAdd.length > 0) {
    await tx.supplierBrand.createMany({
      data: toAdd.map((brandId) => ({ supplierId, brandId })),
    });
  }

  return { toRemove, toAdd };
}

export async function updateSupplierProfile(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = updateSupplierSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid supplier details.",
    );
  }

  const input = parsed.data;
  const existing = await prisma.supplier.findFirst({
    where: { id: input.supplierId, companyId: admin.companyId },
    include: { brands: { select: { brandId: true } } },
  });

  if (!existing) {
    throw new SupplierDomainError("NOT_FOUND", "Supplier not found.");
  }

  await assertUniqueSupplierName(admin.companyId, input.name, existing.id);
  await assertBrandsBelongToCompany(admin.companyId, input.brandIds);

  const currentBrandIds = existing.brands.map((b) => b.brandId);
  const nextBrandIds = [...new Set(input.brandIds)];
  const activeRequestBrandIds = await loadActiveRequestBrandIds(existing.id);

  const blocked = blockedBrandRemovals({
    currentBrandIds,
    nextBrandIds,
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
      nextBrandIds,
      activeRequestBrandIds,
    })
  ) {
    throw new SupplierDomainError(
      "ALL_BRANDS_LOCKED",
      "Cannot turn off All Brands while active requests exist for brands not still selected.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const before = profileSnapshot({
      name: existing.name,
      status: existing.status,
      supportsAllBrands: existing.supportsAllBrands,
      contactName: existing.contactName,
      contactEmail: existing.contactEmail,
      contactPhone: existing.contactPhone,
      addressLine1: existing.addressLine1,
      addressLine2: existing.addressLine2,
      city: existing.city,
      region: existing.region,
      postalCode: existing.postalCode,
      country: existing.country,
      notes: existing.notes,
      brandIds: currentBrandIds,
    });

    const updated = await tx.supplier.update({
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
      },
    });

    const brandDelta = await syncBrandMemberships(
      tx,
      existing.id,
      currentBrandIds,
      nextBrandIds,
    );

    const after = profileSnapshot({
      name: updated.name,
      status: updated.status,
      supportsAllBrands: updated.supportsAllBrands,
      contactName: updated.contactName,
      contactEmail: updated.contactEmail,
      contactPhone: updated.contactPhone,
      addressLine1: updated.addressLine1,
      addressLine2: updated.addressLine2,
      city: updated.city,
      region: updated.region,
      postalCode: updated.postalCode,
      country: updated.country,
      notes: updated.notes,
      brandIds: nextBrandIds,
    });

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: existing.id,
      action: "UPDATE",
      beforeJson: before,
      afterJson: after,
    });

    if (brandDelta.toAdd.length > 0 || brandDelta.toRemove.length > 0) {
      await writeSupplierAuditLog({
        tx,
        actorUserId: admin.id,
        entityId: existing.id,
        action: "BRANDS_CHANGE",
        beforeJson: { brandIds: currentBrandIds },
        afterJson: {
          brandIds: nextBrandIds,
          added: brandDelta.toAdd,
          removed: brandDelta.toRemove,
        },
      });
    }
  });

  return { id: existing.id };
}

export async function changeSupplierStatus(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = supplierStatusChangeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError("VALIDATION", "Invalid status change.");
  }

  const existing = await prisma.supplier.findFirst({
    where: { id: parsed.data.supplierId, companyId: admin.companyId },
    select: {
      id: true,
      status: true,
      registrationSource: true,
      rejectionReason: true,
    },
  });

  if (!existing) {
    throw new SupplierDomainError("NOT_FOUND", "Supplier not found.");
  }

  // Registration rejection must use rejectSupplierRegistration (requires reason).
  if (existing.status === "REJECTED" && parsed.data.status === "INACTIVE") {
    throw new SupplierDomainError(
      "INVALID_STATUS",
      "Rejected registrations cannot be deactivated this way.",
    );
  }

  if (existing.status === parsed.data.status) {
    return { id: existing.id, status: existing.status };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        reviewedAt: now,
        reviewedByUserId: admin.id,
        // Activation clears a prior rejection marker; deactivation is ordinary.
        ...(parsed.data.status === "ACTIVE"
          ? { rejectionReason: null }
          : {}),
      },
      select: { id: true, status: true },
    });

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: existing.id,
      action: "STATUS_CHANGE",
      beforeJson: {
        status: existing.status,
        registrationSource: existing.registrationSource,
      },
      afterJson: {
        status: updated.status,
        event:
          parsed.data.status === "ACTIVE"
            ? "SUPPLIER_ACTIVATED"
            : "SUPPLIER_DEACTIVATED",
      },
    });
  });

  return { id: existing.id, status: parsed.data.status };
}

export type { SupplierProfileInput };
