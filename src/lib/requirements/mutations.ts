import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { requireStaffPermission } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";

import { createDraftRequirementFromUnknown } from "./draft-service";
import { RequirementDomainError } from "./errors";
import {
  addDraftRequirementItemSchema,
  confirmRequirementSchema,
  removeDraftRequirementItemSchema,
  updateDraftRequirementItemSchema,
  updateDraftRequirementMetaSchema,
} from "./schema";

async function loadDraftForCompany(requirementId: string, companyId: string) {
  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, companyId },
    include: { items: { select: { id: true, productId: true } } },
  });
  if (!requirement) {
    throw new RequirementDomainError("NOT_FOUND", "Requirement not found.");
  }
  if (requirement.status !== "DRAFT") {
    throw new RequirementDomainError(
      "NOT_DRAFT",
      "Only draft requirements can be edited.",
    );
  }
  return requirement;
}

export async function createManualDraftRequirement(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const created = await createDraftRequirementFromUnknown({
    actor: user,
    raw,
  });
  return { id: created.id };
}

export async function updateDraftRequirementMeta(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = updateDraftRequirementMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequirementDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid details.",
    );
  }

  const existing = await loadDraftForCompany(
    parsed.data.requirementId,
    user.companyId,
  );

  await prisma.$transaction(async (tx) => {
    await tx.requirement.update({
      where: { id: existing.id },
      data: {
        title: parsed.data.title ?? null,
        notes: parsed.data.notes ?? null,
      },
    });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: existing.id,
      action: "UPDATE",
      beforeJson: { title: existing.title, notes: existing.notes },
      afterJson: {
        title: parsed.data.title ?? null,
        notes: parsed.data.notes ?? null,
        event: "REQUIREMENT_DRAFT_META_UPDATED",
      },
    });
  });

  return { id: existing.id };
}

export async function addDraftRequirementItem(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = addDraftRequirementItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequirementDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid item.",
    );
  }

  const existing = await loadDraftForCompany(
    parsed.data.requirementId,
    user.companyId,
  );

  if (existing.items.some((item) => item.productId === parsed.data.productId)) {
    throw new RequirementDomainError(
      "DUPLICATE_PRODUCT",
      "That product is already on this requirement.",
    );
  }

  const product = await prisma.product.findFirst({
    where: {
      id: parsed.data.productId,
      companyId: user.companyId,
      brandId: existing.brandId,
      isActive: true,
    },
    select: { id: true, name: true },
  });
  if (!product) {
    throw new RequirementDomainError(
      "INVALID_PRODUCT",
      "Product is invalid for this brand.",
    );
  }

  const itemId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.requirementItem.create({
      data: {
        id: itemId,
        requirementId: existing.id,
        productId: product.id,
        quantityPlanned: new Prisma.Decimal(parsed.data.quantityPlanned),
        notes: parsed.data.notes ?? null,
      },
    });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: existing.id,
      action: "UPDATE",
      afterJson: {
        event: "REQUIREMENT_ITEM_ADDED",
        itemId,
        productId: product.id,
        quantityPlanned: parsed.data.quantityPlanned,
      },
    });
  });

  return { id: existing.id, itemId };
}

export async function updateDraftRequirementItem(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = updateDraftRequirementItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequirementDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid item.",
    );
  }

  const existing = await loadDraftForCompany(
    parsed.data.requirementId,
    user.companyId,
  );
  const item = existing.items.find((row) => row.id === parsed.data.itemId);
  if (!item) {
    throw new RequirementDomainError("NOT_FOUND", "Line item not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.requirementItem.update({
      where: { id: item.id },
      data: {
        quantityPlanned: new Prisma.Decimal(parsed.data.quantityPlanned),
        notes: parsed.data.notes ?? null,
      },
    });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: existing.id,
      action: "UPDATE",
      afterJson: {
        event: "REQUIREMENT_ITEM_UPDATED",
        itemId: item.id,
        quantityPlanned: parsed.data.quantityPlanned,
      },
    });
  });

  return { id: existing.id, itemId: item.id };
}

export async function removeDraftRequirementItem(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = removeDraftRequirementItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequirementDomainError("VALIDATION", "Invalid remove request.");
  }

  const existing = await loadDraftForCompany(
    parsed.data.requirementId,
    user.companyId,
  );
  const item = existing.items.find((row) => row.id === parsed.data.itemId);
  if (!item) {
    throw new RequirementDomainError("NOT_FOUND", "Line item not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.requirementItem.delete({ where: { id: item.id } });
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: existing.id,
      action: "UPDATE",
      afterJson: {
        event: "REQUIREMENT_ITEM_REMOVED",
        itemId: item.id,
        productId: item.productId,
      },
    });
  });

  return { id: existing.id };
}

/**
 * Confirm a draft. Idempotent if already CONFIRMED by the same flow guard;
 * concurrent confirms use updateMany status=DRAFT claim.
 */
export async function confirmRequirement(raw: unknown) {
  const user = await requireStaffPermission("CONFIRM_REQUIREMENT");
  const parsed = confirmRequirementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequirementDomainError("VALIDATION", "Invalid confirmation.");
  }

  const existing = await prisma.requirement.findFirst({
    where: { id: parsed.data.requirementId, companyId: user.companyId },
    include: { _count: { select: { items: true } } },
  });
  if (!existing) {
    throw new RequirementDomainError("NOT_FOUND", "Requirement not found.");
  }

  if (existing.status === "CONFIRMED") {
    return { id: existing.id, status: "CONFIRMED" as const, already: true };
  }

  if (existing.status !== "DRAFT") {
    throw new RequirementDomainError(
      "NOT_DRAFT",
      "Only draft requirements can be confirmed.",
    );
  }

  if (existing._count.items < 1) {
    throw new RequirementDomainError(
      "EMPTY_ITEMS",
      "Add at least one product before confirming.",
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.requirement.updateMany({
      where: {
        id: existing.id,
        companyId: user.companyId,
        status: "DRAFT",
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: now,
        confirmedById: user.id,
      },
    });

    if (claimed.count !== 1) {
      throw new RequirementDomainError(
        "ALREADY_CONFIRMED",
        "This requirement was already confirmed.",
      );
    }

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: existing.id,
      action: "STATUS_CHANGE",
      beforeJson: { status: "DRAFT" },
      afterJson: {
        status: "CONFIRMED",
        event: "REQUIREMENT_CONFIRMED",
        confirmedAt: now.toISOString(),
      },
    });
  });

  return { id: existing.id, status: "CONFIRMED" as const, already: false };
}
