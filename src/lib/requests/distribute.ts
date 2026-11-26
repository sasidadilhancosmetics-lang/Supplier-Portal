import "server-only";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import {
  ACTIVE_REQUEST_STATUSES,
  buildQuantityByItemId,
  distributeRequirementInTransaction,
  recipientsFromPlanned,
  type DistributePreview,
} from "./distribute-core";
import { RequestDomainError } from "./errors";
import { filterMatchingSuppliers, type MatchableSupplier } from "./matching";
import { distributeRequirementSchema } from "./schema";

export async function listMatchingSuppliersForRequirement(
  requirementId: string,
): Promise<DistributePreview> {
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

  const quantityByItemId = buildQuantityByItemId(
    preview.requirement.items,
    parsed.data.quantityOverrides,
    parsed.data.acknowledgeOverQty,
  );
  const explicitRecipients = recipientsFromPlanned({
    recipients,
    items: preview.requirement.items,
    quantityByItemId,
  });

  const deadline = parsed.data.responseDeadline
    ? new Date(parsed.data.responseDeadline)
    : null;

  const result = await prisma.$transaction(async (tx) =>
    distributeRequirementInTransaction(tx, {
      actor: user,
      requirementId: parsed.data.requirementId,
      brandId: preview.requirement.brand.id,
      brandName: preview.requirement.brand.name,
      mode: parsed.data.mode,
      items: preview.requirement.items,
      recipients: explicitRecipients,
      responseDeadline: deadline,
    }),
  );

  return {
    requestIds: result.requestIds,
    count: result.requestIds.length,
    skippedSupplierIds: result.skippedSupplierIds,
  };
}
