import "server-only";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { writeAuditLog } from "@/lib/audit";
import { z } from "zod";

import { ProductDomainError } from "@/lib/products/errors";

const createBrandSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(200),
});

async function brandsForCompanyId(companyId: string) {
  return prisma.brand.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Brands for product master (MANAGE_PRODUCTS / ADMIN). */
export async function listBrandsForCompany() {
  const user = await requireStaffPermission("MANAGE_PRODUCTS");
  return brandsForCompanyId(user.companyId);
}

/**
 * Brands for requirement UI filters / draft forms.
 * Uses the same read ACL as requirement list (MANAGE / CONFIRM / SEND / ADMIN).
 */
export async function listBrandsForRequirements() {
  const { requireRequirementReadAccess } = await import(
    "@/lib/requirements/access"
  );
  const user = await requireRequirementReadAccess();
  return brandsForCompanyId(user.companyId);
}

/**
 * Development helper: create a brand for the purchasing company.
 * Uses MANAGE_BRANDS (ADMIN bypasses). Needed so products can be created
 * before a full brand module exists.
 */
export async function createBrandForCompany(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_BRANDS");
  const parsed = createBrandSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProductDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid brand.",
    );
  }

  const name = parsed.data.name;
  const existing = await prisma.brand.findFirst({
    where: {
      companyId: user.companyId,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (existing) {
    return existing;
  }

  const created = await prisma.$transaction(async (tx) => {
    const brand = await tx.brand.create({
      data: {
        id: createId(),
        companyId: user.companyId,
        name,
      },
      select: { id: true, name: true },
    });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Brand",
      entityId: brand.id,
      action: "CREATE",
      afterJson: { name: brand.name, event: "BRAND_CREATED" },
    });
    return brand;
  });

  return created;
}
