import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { requireStaffPermission } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { createUserNotification } from "@/lib/notifications";

import { RequestDomainError } from "./errors";
import { filterMatchingSuppliers, type MatchableSupplier } from "./matching";
import { distributeRequirementSchema } from "./schema";

const ACTIVE_REQUEST_STATUSES = [
  "NEW",
  "PARTIALLY_RESPONDED",
  "RESPONDED",
] as const;

export async function listMatchingSuppliersForRequirement(
  requirementId: string,
) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, companyId: user.companyId },
    select: {
      id: true,
      status: true,
      brandId: true,
      brand: { select: { id: true, name: true } },
      title: true,
      items: {
        select: {
          id: true,
          quantityPlanned: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              priorityStatus: true,
            },
          },
        },
      },
    },
  });
  if (!requirement) {
    throw new RequestDomainError("NOT_FOUND", "Requirement not found.");
  }
  if (requirement.status !== "CONFIRMED") {
    throw new RequestDomainError(
      "NOT_CONFIRMED",
      "Only confirmed requirements can be distributed.",
    );
  }

  const suppliers = await prisma.supplier.findMany({
    where: { companyId: user.companyId },
    select: {
      id: true,
      name: true,
      status: true,
      supportsAllBrands: true,
      brands: { select: { brandId: true } },
    },
    orderBy: { name: "asc" },
  });

  const matchable: MatchableSupplier[] = suppliers.map((s) => ({
    id: s.id,
    status: s.status,
    supportsAllBrands: s.supportsAllBrands,
    brandIds: s.brands.map((b) => b.brandId),
  }));

  const matchingIds = new Set(
    filterMatchingSuppliers(matchable, requirement.brandId).map((s) => s.id),
  );

  const existing = await prisma.supplierRequest.findMany({
    where: {
      companyId: user.companyId,
      requirementId,
      status: { in: [...ACTIVE_REQUEST_STATUSES] },
    },
    select: { supplierId: true, status: true },
  });
  const activeBySupplier = new Map(
    existing.map((row) => [row.supplierId, row.status]),
  );

  return {
    requirement: {
      id: requirement.id,
      title: requirement.title,
      brand: requirement.brand,
      items: requirement.items.map((item) => ({
        id: item.id,
        quantityPlanned: item.quantityPlanned.toString(),
        product: item.product,
      })),
    },
    suppliers: suppliers
      .filter((s) => matchingIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        supportsAllBrands: s.supportsAllBrands,
        alreadyRequested: activeBySupplier.has(s.id),
        existingStatus: activeBySupplier.get(s.id) ?? null,
      })),
  };
}

/**
 * Create SupplierRequest + RequestItem rows for selected ACTIVE matching suppliers.
 * Skips suppliers that already have an active request for this requirement.
 */
export async function distributeRequirement(raw: unknown) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const parsed = distributeRequirementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequestDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid distribution request.",
    );
  }

  const preview = await listMatchingSuppliersForRequirement(
    parsed.data.requirementId,
  );
  const eligible = preview.suppliers.filter(
    (s) => s.status === "ACTIVE" && !s.alreadyRequested,
  );

  let recipients = eligible;
  if (parsed.data.mode === "SELECTED") {
    const selected = new Set(parsed.data.supplierIds);
    if (selected.size === 0) {
      throw new RequestDomainError(
        "NO_RECIPIENTS",
        "Select at least one supplier.",
      );
    }
    recipients = eligible.filter((s) => selected.has(s.id));
    const invalid = [...selected].filter(
      (id) => !eligible.some((s) => s.id === id),
    );
    if (invalid.length > 0) {
      throw new RequestDomainError(
        "INVALID_SUPPLIER",
        "One or more selected suppliers are not eligible.",
      );
    }
  }

  if (recipients.length === 0) {
    throw new RequestDomainError(
      "NO_RECIPIENTS",
      "No eligible suppliers to send to (active, matching, without an open request).",
    );
  }

  if (preview.requirement.items.length === 0) {
    throw new RequestDomainError(
      "EMPTY_ITEMS",
      "Requirement has no line items.",
    );
  }

  const deadline = parsed.data.responseDeadline
    ? new Date(parsed.data.responseDeadline)
    : null;
  const now = new Date();

  const createdIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];

    for (const supplier of recipients) {
      // Re-check inside tx to reduce duplicate races.
      const existing = await tx.supplierRequest.findFirst({
        where: {
          companyId: user.companyId,
          requirementId: parsed.data.requirementId,
          supplierId: supplier.id,
          status: { in: [...ACTIVE_REQUEST_STATUSES] },
        },
        select: { id: true },
      });
      if (existing) {
        continue;
      }

      const requestId = createId();
      await tx.supplierRequest.create({
        data: {
          id: requestId,
          companyId: user.companyId,
          requirementId: parsed.data.requirementId,
          supplierId: supplier.id,
          brandId: preview.requirement.brand.id,
          status: "NEW",
          responseDeadline: deadline,
          sentAt: now,
          items: {
            // Nested create inherits supplierId + companyId from the parent
            // composite FK — do not pass those fields (Prisma rejects them).
            create: preview.requirement.items.map((item) => ({
              id: createId(),
              requirementItemId: item.id,
              productId: item.product.id,
              quantityRequested: new Prisma.Decimal(item.quantityPlanned),
            })),
          },
        },
      });
      ids.push(requestId);

      const supplierUsers = await tx.user.findMany({
        where: {
          companyId: user.companyId,
          supplierId: supplier.id,
          role: "SUPPLIER",
          isActive: true,
        },
        select: { id: true },
      });
      for (const su of supplierUsers) {
        await createUserNotification({
          tx,
          userId: su.id,
          title: "New supplier request",
          body: `A new request was sent for brand ${preview.requirement.brand.name}.`,
          entityType: "SupplierRequest",
          entityId: requestId,
        });
      }
    }

    if (ids.length === 0) {
      throw new RequestDomainError(
        "DUPLICATE_REQUEST",
        "All selected suppliers already have an active request.",
      );
    }

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Requirement",
      entityId: parsed.data.requirementId,
      action: "UPDATE",
      afterJson: {
        event: "SUPPLIER_REQUESTS_DISTRIBUTED",
        mode: parsed.data.mode,
        requestIds: ids,
        supplierCount: ids.length,
        responseDeadline: deadline?.toISOString() ?? null,
      },
    });

    return ids;
  });

  return { requestIds: createdIds, count: createdIds.length };
}
