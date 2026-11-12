import "server-only";

import { requireStaffPermission } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";

import { ProductDomainError } from "./errors";
import {
  createProvisionalProductSchema,
  updateProductSchema,
} from "./schema";

async function assertBrandInCompany(companyId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, companyId },
    select: { id: true },
  });
  if (!brand) {
    throw new ProductDomainError("INVALID_BRAND", "Brand is invalid.");
  }
}

/**
 * Create a development/test product as PROVISIONAL only.
 * Never invents ERP-linked masters or erpItemId values.
 */
export async function createProvisionalProduct(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_PRODUCTS");
  const parsed = createProvisionalProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProductDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid product details.",
    );
  }
  const input = parsed.data;
  await assertBrandInCompany(user.companyId, input.brandId);

  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        id: createId(),
        companyId: user.companyId,
        brandId: input.brandId,
        name: input.name,
        sku: input.sku ?? null,
        unitOfMeasure: input.unitOfMeasure ?? null,
        priorityStatus: input.priorityStatus,
        masterStatus: "PROVISIONAL",
        erpItemId: null,
        cosmoItemId: null,
        isActive: input.isActive,
      },
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Product",
      entityId: product.id,
      action: "CREATE",
      afterJson: {
        event: "PRODUCT_PROVISIONAL_CREATED",
        name: product.name,
        brandId: product.brandId,
        sku: product.sku,
        priorityStatus: product.priorityStatus,
        masterStatus: product.masterStatus,
      },
    });

    return product;
  });

  return { id: created.id };
}

/**
 * Edit permitted fields. Cannot promote to ERP_LINKED or set erpItemId.
 * ERP-linked products: name/sku/UOM/priority/active/brand edits only;
 * erp identifiers remain untouched.
 */
export async function updateProduct(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_PRODUCTS");
  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProductDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid product details.",
    );
  }
  const input = parsed.data;

  const existing = await prisma.product.findFirst({
    where: { id: input.productId, companyId: user.companyId },
  });
  if (!existing) {
    throw new ProductDomainError("NOT_FOUND", "Product not found.");
  }

  await assertBrandInCompany(user.companyId, input.brandId);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        brandId: input.brandId,
        sku: input.sku ?? null,
        unitOfMeasure: input.unitOfMeasure ?? null,
        priorityStatus: input.priorityStatus,
        isActive: input.isActive,
        // masterStatus / erpItemId / cosmoItemId intentionally unchanged
      },
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Product",
      entityId: existing.id,
      action: "UPDATE",
      beforeJson: {
        name: existing.name,
        brandId: existing.brandId,
        sku: existing.sku,
        priorityStatus: existing.priorityStatus,
        isActive: existing.isActive,
        masterStatus: existing.masterStatus,
      },
      afterJson: {
        name: updated.name,
        brandId: updated.brandId,
        sku: updated.sku,
        priorityStatus: updated.priorityStatus,
        isActive: updated.isActive,
        masterStatus: updated.masterStatus,
      },
    });
  });

  return { id: existing.id };
}
