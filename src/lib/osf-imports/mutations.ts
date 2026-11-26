import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import { requireStaffPermission } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { createBrandForCompany } from "@/lib/brands/queries";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";

import { OsfImportDomainError } from "./errors";
import {
  createBrandAndResolveSchema,
  excludeImportLineSchema,
  includeZeroQtyLineSchema,
  linkImportLineProductSchema,
  resolveImportLineBrandSchema,
  restoreImportLineSchema,
  updateImportLineQtySchema,
} from "./schema";
import {
  isImportEditableStatus,
  recomputeImportReviewStatus,
} from "./status";

type Tx = Prisma.TransactionClient;

async function loadEditableImport(
  tx: Tx,
  args: { importId: string; companyId: string; importVersion: number },
) {
  const osfImport = await tx.osfImport.findFirst({
    where: { id: args.importId, companyId: args.companyId },
  });
  if (!osfImport) {
    throw new OsfImportDomainError("NOT_FOUND", "Import not found.");
  }
  if (!isImportEditableStatus(osfImport.status)) {
    throw new OsfImportDomainError(
      "NOT_EDITABLE",
      "This import is no longer editable.",
    );
  }
  if (osfImport.version !== args.importVersion) {
    throw new OsfImportDomainError(
      "VERSION_CONFLICT",
      "Import was updated elsewhere. Refresh and try again.",
    );
  }
  return osfImport;
}

async function loadEditableLine(
  tx: Tx,
  args: {
    lineId: string;
    importId: string;
    companyId: string;
    lineVersion: number;
  },
) {
  const line = await tx.osfImportLine.findFirst({
    where: {
      id: args.lineId,
      osfImportId: args.importId,
      companyId: args.companyId,
    },
  });
  if (!line) {
    throw new OsfImportDomainError("NOT_FOUND", "Import line not found.");
  }
  if (line.version !== args.lineVersion) {
    throw new OsfImportDomainError(
      "VERSION_CONFLICT",
      "This line was updated elsewhere. Refresh and try again.",
    );
  }
  return line;
}

async function bumpImportStatus(tx: Tx, args: { importId: string; companyId: string; actor: ProvisionedAppUser; fromVersion: number }) {
  const lines = await tx.osfImportLine.findMany({
    where: { osfImportId: args.importId, companyId: args.companyId },
    select: { mappingStatus: true, quantityPlanned: true },
  });
  const nextStatus = recomputeImportReviewStatus(lines);
  const updated = await tx.osfImport.updateMany({
    where: {
      id: args.importId,
      companyId: args.companyId,
      version: args.fromVersion,
    },
    data: {
      status: nextStatus,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new OsfImportDomainError(
      "VERSION_CONFLICT",
      "Import was updated elsewhere. Refresh and try again.",
    );
  }
  return nextStatus;
}

async function ensureDraftRequirement(
  tx: Tx,
  args: {
    companyId: string;
    importId: string;
    brandId: string;
    brandName: string;
  },
): Promise<string> {
  const existing = await tx.requirement.findFirst({
    where: {
      companyId: args.companyId,
      osfImportId: args.importId,
      brandId: args.brandId,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status !== "DRAFT") {
      throw new OsfImportDomainError(
        "NOT_EDITABLE",
        "The brand requirement is no longer a draft.",
      );
    }
    return existing.id;
  }
  const id = createId();
  await tx.requirement.create({
    data: {
      id,
      companyId: args.companyId,
      brandId: args.brandId,
      osfImportId: args.importId,
      status: "DRAFT",
      title: `OSF import — ${args.brandName}`,
    },
  });
  return id;
}

async function unlinkLineItem(
  tx: Tx,
  line: {
    id: string;
    requirementItemId: string | null;
    requirementId: string | null;
  },
) {
  const itemId = line.requirementItemId;
  await tx.osfImportLine.update({
    where: { id: line.id },
    data: {
      requirementItemId: null,
      requirementId: null,
    },
  });
  if (itemId) {
    await tx.requirementItem.delete({ where: { id: itemId } });
  }
}

async function maybeDeleteEmptyDraftRequirement(
  tx: Tx,
  args: { requirementId: string | null; companyId: string },
) {
  if (!args.requirementId) return;
  const remaining = await tx.osfImportLine.count({
    where: {
      requirementId: args.requirementId,
      companyId: args.companyId,
      requirementItemId: { not: null },
    },
  });
  if (remaining > 0) return;
  const req = await tx.requirement.findFirst({
    where: {
      id: args.requirementId,
      companyId: args.companyId,
      status: "DRAFT",
    },
    include: { _count: { select: { items: true } } },
  });
  if (!req || req._count.items > 0) return;
  await tx.requirement.delete({ where: { id: req.id } });
}

function rematchStatus(args: {
  quantityPlanned: Prisma.Decimal;
  brandId: string | null;
  productMatches: Array<{ id: string }>;
}): {
  mappingStatus:
    | "MATCHED_SKU"
    | "UNKNOWN_SKU"
    | "AMBIGUOUS_SKU"
    | "UNKNOWN_BRAND"
    | "REJECTED_ZERO_QTY";
  productId: string | null;
} {
  if (Number(args.quantityPlanned) === 0) {
    return { mappingStatus: "REJECTED_ZERO_QTY", productId: null };
  }
  if (!args.brandId) {
    return { mappingStatus: "UNKNOWN_BRAND", productId: null };
  }
  if (args.productMatches.length === 0) {
    return { mappingStatus: "UNKNOWN_SKU", productId: null };
  }
  if (args.productMatches.length > 1) {
    return { mappingStatus: "AMBIGUOUS_SKU", productId: null };
  }
  return {
    mappingStatus: "MATCHED_SKU",
    productId: args.productMatches[0]!.id,
  };
}

export async function updateImportLineQuantity(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = updateImportLineQtySchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid quantity update.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });
    if (
      line.mappingStatus === "EXCLUDED" ||
      line.mappingStatus === "REJECTED_ZERO_QTY" ||
      line.mappingStatus === "REJECTED_INVALID_QTY"
    ) {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "Cannot edit quantity on an excluded or rejected line.",
      );
    }

    const qty = new Prisma.Decimal(input.quantityPlanned);
    const lineUpdate = await tx.osfImportLine.updateMany({
      where: {
        id: line.id,
        companyId: user.companyId,
        version: input.lineVersion,
      },
      data: {
        quantityPlanned: qty,
        version: { increment: 1 },
      },
    });
    if (lineUpdate.count !== 1) {
      throw new OsfImportDomainError(
        "VERSION_CONFLICT",
        "This line was updated elsewhere. Refresh and try again.",
      );
    }

    if (line.requirementItemId) {
      await tx.requirementItem.update({
        where: { id: line.requirementItemId },
        data: { quantityPlanned: qty },
      });
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_LINE_QTY_UPDATED",
        lineId: line.id,
        quantityPlanned: qty.toString(),
        quantityProposed: line.quantityProposed.toString(),
        importStatus: status,
      },
    });

    return { importId: input.importId, lineId: line.id, status };
  });
}

export async function linkImportLineToProduct(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = linkImportLineProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid product link.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });

    if (line.mappingStatus === "EXCLUDED") {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "Restore the line before linking a product.",
      );
    }
    if (
      line.mappingStatus === "REJECTED_ZERO_QTY" ||
      line.mappingStatus === "REJECTED_INVALID_QTY"
    ) {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "Use Include with quantity to bring a rejected zero-qty line back into review.",
      );
    }
    if (Number(line.quantityPlanned) <= 0) {
      throw new OsfImportDomainError(
        "VALIDATION",
        "Planned quantity must be greater than zero to link a product.",
      );
    }
    if (!line.brandId) {
      throw new OsfImportDomainError(
        "INVALID_BRAND",
        "Resolve the brand before linking a product.",
      );
    }

    const product = await tx.product.findFirst({
      where: {
        id: input.productId,
        companyId: user.companyId,
        brandId: line.brandId,
        isActive: true,
      },
    });
    if (!product) {
      throw new OsfImportDomainError(
        "INVALID_PRODUCT",
        "Product is invalid for this brand.",
      );
    }

    if (line.requirementItemId) {
      await tx.requirementItem.update({
        where: { id: line.requirementItemId },
        data: {
          productId: product.id,
          quantityPlanned: line.quantityPlanned,
        },
      });
      const relinked = await tx.osfImportLine.updateMany({
        where: { id: line.id, version: input.lineVersion },
        data: {
          productId: product.id,
          mappingStatus: "MATCHED_SKU",
          resolutionNote: null,
          version: { increment: 1 },
        },
      });
      if (relinked.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "This line was updated elsewhere. Refresh and try again.",
        );
      }
    } else {
      const requirementId = await ensureDraftRequirement(tx, {
        companyId: user.companyId,
        importId: input.importId,
        brandId: line.brandId,
        brandName: line.brandNameSnapshot,
      });
      const itemId = createId();
      await tx.requirementItem.create({
        data: {
          id: itemId,
          requirementId,
          productId: product.id,
          quantityPlanned: line.quantityPlanned,
          externalLineId: line.lineKey,
        },
      });
      const linked = await tx.osfImportLine.updateMany({
        where: { id: line.id, version: input.lineVersion },
        data: {
          productId: product.id,
          brandId: line.brandId,
          requirementId,
          requirementItemId: itemId,
          mappingStatus: "MATCHED_SKU",
          resolutionNote: null,
          version: { increment: 1 },
        },
      });
      if (linked.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "This line was updated elsewhere. Refresh and try again.",
        );
      }
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_LINE_PRODUCT_LINKED",
        lineId: line.id,
        productId: product.id,
        importStatus: status,
      },
    });

    return { importId: input.importId, lineId: line.id, status };
  });
}

export async function resolveImportLineBrand(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = resolveImportLineBrandSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid brand resolution.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });

    const brand = await tx.brand.findFirst({
      where: { id: input.brandId, companyId: user.companyId },
    });
    if (!brand) {
      throw new OsfImportDomainError("INVALID_BRAND", "Brand is invalid.");
    }

    const targetLines = input.applyToBrandGroup
      ? await tx.osfImportLine.findMany({
          where: {
            osfImportId: input.importId,
            companyId: user.companyId,
            mappingStatus: "UNKNOWN_BRAND",
            brandNameSnapshot: line.brandNameSnapshot,
            cosmoVendorId: line.cosmoVendorId,
          },
        })
      : [line];

    if (
      !input.applyToBrandGroup &&
      line.mappingStatus !== "UNKNOWN_BRAND" &&
      line.brandId
    ) {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "This line already has a brand. Use product linking instead.",
      );
    }

    for (const target of targetLines) {
      const matches = await tx.product.findMany({
        where: {
          companyId: user.companyId,
          brandId: brand.id,
          isActive: true,
          sku: target.sku,
        },
        select: { id: true },
      });
      const rematched = rematchStatus({
        quantityPlanned: target.quantityPlanned,
        brandId: brand.id,
        productMatches: matches,
      });

      if (rematched.mappingStatus === "MATCHED_SKU" && rematched.productId) {
        if (target.requirementItemId) {
          await unlinkLineItem(tx, target);
        }
        const requirementId = await ensureDraftRequirement(tx, {
          companyId: user.companyId,
          importId: input.importId,
          brandId: brand.id,
          brandName: brand.name,
        });
        const itemId = createId();
        await tx.requirementItem.create({
          data: {
            id: itemId,
            requirementId,
            productId: rematched.productId,
            quantityPlanned: target.quantityPlanned,
            externalLineId: target.lineKey,
          },
        });
        await tx.osfImportLine.update({
          where: { id: target.id },
          data: {
            brandId: brand.id,
            productId: rematched.productId,
            requirementId,
            requirementItemId: itemId,
            mappingStatus: "MATCHED_SKU",
            resolutionNote: null,
            version: { increment: 1 },
          },
        });
      } else {
        if (target.requirementItemId) {
          const reqId = target.requirementId;
          await unlinkLineItem(tx, target);
          await maybeDeleteEmptyDraftRequirement(tx, {
            requirementId: reqId,
            companyId: user.companyId,
          });
        }
        await tx.osfImportLine.update({
          where: { id: target.id },
          data: {
            brandId: brand.id,
            productId: null,
            requirementId: null,
            requirementItemId: null,
            mappingStatus: rematched.mappingStatus,
            resolutionNote: null,
            version: { increment: 1 },
          },
        });
      }
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_BRAND_RESOLVED",
        brandId: brand.id,
        lineIds: targetLines.map((l) => l.id),
        applyToBrandGroup: input.applyToBrandGroup,
        importStatus: status,
      },
    });

    return {
      importId: input.importId,
      brandId: brand.id,
      status,
      affectedCount: targetLines.length,
    };
  });
}

export async function excludeImportLine(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = excludeImportLineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid exclusion.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });

    const previousRequirementId = line.requirementId;
    if (line.requirementItemId) {
      await unlinkLineItem(tx, line);
      await maybeDeleteEmptyDraftRequirement(tx, {
        requirementId: previousRequirementId,
        companyId: user.companyId,
      });
    }

    const updated = await tx.osfImportLine.updateMany({
      where: { id: line.id, version: input.lineVersion },
      data: {
        mappingStatus: "EXCLUDED",
        resolutionNote: input.reason,
        requirementId: null,
        requirementItemId: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new OsfImportDomainError(
        "VERSION_CONFLICT",
        "This line was updated elsewhere. Refresh and try again.",
      );
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_LINE_EXCLUDED",
        lineId: line.id,
        reason: input.reason,
        importStatus: status,
      },
    });

    return { importId: input.importId, lineId: line.id, status };
  });
}

export async function restoreImportLine(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = restoreImportLineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid restore.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });
    if (line.mappingStatus !== "EXCLUDED") {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "Only excluded lines can be restored.",
      );
    }

    // Prefer a staff-linked product preserved through exclude; otherwise rematch by SKU.
    let rematched: ReturnType<typeof rematchStatus> | null = null;
    if (line.productId && line.brandId) {
      const linked = await tx.product.findFirst({
        where: {
          id: line.productId,
          companyId: user.companyId,
          brandId: line.brandId,
          isActive: true,
        },
        select: { id: true },
      });
      if (linked) {
        rematched = rematchStatus({
          quantityPlanned: line.quantityPlanned,
          brandId: line.brandId,
          productMatches: [linked],
        });
      }
    }
    if (!rematched) {
      const matches = line.brandId
        ? await tx.product.findMany({
            where: {
              companyId: user.companyId,
              brandId: line.brandId,
              isActive: true,
              sku: line.sku,
            },
            select: { id: true },
          })
        : [];
      rematched = rematchStatus({
        quantityPlanned: line.quantityPlanned,
        brandId: line.brandId,
        productMatches: matches,
      });
    }

    if (rematched.mappingStatus === "MATCHED_SKU" && rematched.productId && line.brandId) {
      const requirementId = await ensureDraftRequirement(tx, {
        companyId: user.companyId,
        importId: input.importId,
        brandId: line.brandId,
        brandName: line.brandNameSnapshot,
      });
      const itemId = createId();
      await tx.requirementItem.create({
        data: {
          id: itemId,
          requirementId,
          productId: rematched.productId,
          quantityPlanned: line.quantityPlanned,
          externalLineId: line.lineKey,
        },
      });
      const restored = await tx.osfImportLine.updateMany({
        where: { id: line.id, version: input.lineVersion },
        data: {
          mappingStatus: "MATCHED_SKU",
          productId: rematched.productId,
          requirementId,
          requirementItemId: itemId,
          resolutionNote: null,
          version: { increment: 1 },
        },
      });
      if (restored.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "This line was updated elsewhere. Refresh and try again.",
        );
      }
    } else {
      const restored = await tx.osfImportLine.updateMany({
        where: { id: line.id, version: input.lineVersion },
        data: {
          mappingStatus: rematched.mappingStatus,
          productId: null,
          requirementId: null,
          requirementItemId: null,
          resolutionNote: null,
          version: { increment: 1 },
        },
      });
      if (restored.count !== 1) {
        throw new OsfImportDomainError(
          "VERSION_CONFLICT",
          "This line was updated elsewhere. Refresh and try again.",
        );
      }
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_LINE_RESTORED",
        lineId: line.id,
        mappingStatus: rematched.mappingStatus,
        importStatus: status,
      },
    });

    return { importId: input.importId, lineId: line.id, status };
  });
}

/**
 * Explicitly include a REJECTED_ZERO_QTY line with a new planned quantity.
 * quantityProposed stays immutable. Does not create orderable rows without rematch.
 */
export async function includeZeroQtyLine(raw: unknown) {
  const user = await requireStaffPermission("MANAGE_REQUIREMENTS");
  const parsed = includeZeroQtyLineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid include.",
    );
  }
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    await loadEditableImport(tx, {
      importId: input.importId,
      companyId: user.companyId,
      importVersion: input.importVersion,
    });
    const line = await loadEditableLine(tx, {
      lineId: input.lineId,
      importId: input.importId,
      companyId: user.companyId,
      lineVersion: input.lineVersion,
    });
    if (line.mappingStatus !== "REJECTED_ZERO_QTY") {
      throw new OsfImportDomainError(
        "INVALID_STATE",
        "Only zero-quantity rejected lines can be included this way.",
      );
    }

    const qty = new Prisma.Decimal(input.quantityPlanned);
    const matches = line.brandId
      ? await tx.product.findMany({
          where: {
            companyId: user.companyId,
            brandId: line.brandId,
            isActive: true,
            sku: line.sku,
          },
          select: { id: true },
        })
      : [];
    const rematched = rematchStatus({
      quantityPlanned: qty,
      brandId: line.brandId,
      productMatches: matches,
    });

    // Prefer a previously linked product on this line when SKU rematch is empty.
    let productId = rematched.productId;
    let mappingStatus = rematched.mappingStatus;
    if (
      !productId &&
      line.productId &&
      line.brandId &&
      Number(qty) > 0
    ) {
      const linked = await tx.product.findFirst({
        where: {
          id: line.productId,
          companyId: user.companyId,
          brandId: line.brandId,
          isActive: true,
        },
        select: { id: true },
      });
      if (linked) {
        productId = linked.id;
        mappingStatus = "MATCHED_SKU";
      }
    }

    let requirementId: string | null = null;
    let requirementItemId: string | null = null;
    if (mappingStatus === "MATCHED_SKU" && productId && line.brandId) {
      requirementId = await ensureDraftRequirement(tx, {
        companyId: user.companyId,
        importId: input.importId,
        brandId: line.brandId,
        brandName: line.brandNameSnapshot,
      });
      requirementItemId = createId();
      await tx.requirementItem.create({
        data: {
          id: requirementItemId,
          requirementId,
          productId,
          quantityPlanned: qty,
          externalLineId: line.lineKey,
        },
      });
    }

    const updated = await tx.osfImportLine.updateMany({
      where: { id: line.id, version: input.lineVersion },
      data: {
        quantityPlanned: qty,
        mappingStatus,
        productId,
        requirementId,
        requirementItemId,
        resolutionNote: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new OsfImportDomainError(
        "VERSION_CONFLICT",
        "This line was updated elsewhere. Refresh and try again.",
      );
    }

    const status = await bumpImportStatus(tx, {
      importId: input.importId,
      companyId: user.companyId,
      actor: user,
      fromVersion: input.importVersion,
    });

    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "OsfImport",
      entityId: input.importId,
      action: "UPDATE",
      afterJson: {
        event: "OSF_IMPORT_LINE_ZERO_QTY_INCLUDED",
        lineId: line.id,
        quantityPlanned: qty.toString(),
        quantityProposed: line.quantityProposed.toString(),
        mappingStatus,
        importStatus: status,
      },
    });

    return { importId: input.importId, lineId: line.id, status };
  });
}

/** Create brand (MANAGE_BRANDS) then resolve UNKNOWN_BRAND group. */
export async function createBrandAndResolveImportLines(raw: unknown) {
  const parsed = createBrandAndResolveSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OsfImportDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid brand create.",
    );
  }
  const input = parsed.data;

  const user = await requireStaffPermission("MANAGE_BRANDS");
  await requireStaffPermission("MANAGE_REQUIREMENTS");

  const existingBrand = await prisma.brand.findFirst({
    where: {
      companyId: user.companyId,
      name: { equals: input.name, mode: "insensitive" },
    },
    select: { id: true },
  });

  const brand = await createBrandForCompany({ name: input.name });
  const newlyCreated = !existingBrand;

  try {
    return await resolveImportLineBrand({
      importId: input.importId,
      lineId: input.lineId,
      lineVersion: input.lineVersion,
      importVersion: input.importVersion,
      brandId: brand.id,
      applyToBrandGroup: true,
    });
  } catch (error) {
    if (newlyCreated) {
      await prisma.brand
        .deleteMany({
          where: {
            id: brand.id,
            companyId: user.companyId,
            products: { none: {} },
            requirements: { none: {} },
            osfImportLines: { none: {} },
          },
        })
        .catch(() => undefined);
    }
    throw error;
  }
}
