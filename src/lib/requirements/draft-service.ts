import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { ProvisionedAppUser } from "@/lib/auth/types";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";

import { RequirementDomainError } from "./errors";
import {
  createDraftRequirementSchema,
  type CreateDraftRequirementInput,
} from "./schema";

/**
 * Shared draft-requirement creation used by:
 * - Staff manual create (Stage 5A)
 * - Future Cosmo OS OSF adapter (after payload mapping)
 *
 * Caller must already authorize the actor. companyId always comes from actor.
 */
export async function createDraftRequirementForCompany(args: {
  actor: ProvisionedAppUser;
  input: CreateDraftRequirementInput;
}) {
  const { actor, input } = args;

  const brand = await prisma.brand.findFirst({
    where: { id: input.brandId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!brand) {
    throw new RequirementDomainError("INVALID_BRAND", "Brand is invalid.");
  }

  if (input.osfImportId) {
    const osf = await prisma.osfImport.findFirst({
      where: { id: input.osfImportId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!osf) {
      throw new RequirementDomainError(
        "VALIDATION",
        "OSF import reference is invalid.",
      );
    }
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  if (productIds.length !== input.items.length) {
    throw new RequirementDomainError(
      "DUPLICATE_PRODUCT",
      "Each product may appear only once on a requirement.",
    );
  }

  if (productIds.length > 0) {
    const products = await prisma.product.findMany({
      where: {
        companyId: actor.companyId,
        brandId: input.brandId,
        id: { in: productIds },
        isActive: true,
      },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      throw new RequirementDomainError(
        "INVALID_PRODUCT",
        "One or more products are invalid for this brand.",
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.create({
      data: {
        id: createId(),
        companyId: actor.companyId,
        brandId: input.brandId,
        osfImportId: input.osfImportId ?? null,
        status: "DRAFT",
        title: input.title ?? null,
        notes: input.notes ?? null,
        items: {
          create: input.items.map((item) => ({
            id: createId(),
            productId: item.productId,
            quantityPlanned: new Prisma.Decimal(item.quantityPlanned),
            notes: item.notes ?? null,
            externalLineId: item.externalLineId ?? null,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await writeAuditLog({
      tx,
      actorUserId: actor.id,
      entityType: "Requirement",
      entityId: requirement.id,
      action: "CREATE",
      afterJson: {
        event: "REQUIREMENT_DRAFT_CREATED",
        brandId: requirement.brandId,
        status: requirement.status,
        osfImportId: requirement.osfImportId,
        itemCount: requirement.items.length,
        source: input.osfImportId ? "OSF_IMPORT" : "MANUAL",
      },
    });

    return requirement;
  });
}

/** Parse + create draft. Shared entry for UI and future adapter mapping layer. */
export async function createDraftRequirementFromUnknown(args: {
  actor: ProvisionedAppUser;
  raw: unknown;
}) {
  const parsed = createDraftRequirementSchema.safeParse(args.raw);
  if (!parsed.success) {
    throw new RequirementDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid requirement details.",
    );
  }
  return createDraftRequirementForCompany({
    actor: args.actor,
    input: parsed.data,
  });
}
