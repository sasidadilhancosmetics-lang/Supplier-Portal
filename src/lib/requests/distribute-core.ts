import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { createId } from "@/lib/id";
import { createUserNotification } from "@/lib/notifications";
import { lockSuppliers } from "@/lib/suppliers/locking";

import { RequestDomainError } from "./errors";
import { supplierMatchesBrand } from "./matching";

const ACTIVE_REQUEST_STATUSES = [
  "NEW",
  "PARTIALLY_RESPONDED",
  "RESPONDED",
] as const;

export { ACTIVE_REQUEST_STATUSES };

export type DistributePreviewItem = {
  id: string;
  quantityPlanned: string;
  product: { id: string; name: string; sku: string | null; priorityStatus: string };
};

export type DistributePreview = {
  requirement: {
    id: string;
    title: string | null;
    brand: { id: string; name: string };
    items: DistributePreviewItem[];
  };
  suppliers: Array<{
    id: string;
    name: string;
    status: string;
    supportsAllBrands: boolean;
    alreadyRequested: boolean;
    existingStatus: string | null;
  }>;
};

export type QuantityOverride = {
  requirementItemId: string;
  quantityRequested: number;
};

/** Explicit per-supplier request lines. Empty items → no SupplierRequest. */
export type DistributeRecipient = {
  id: string;
  name: string;
  items: Array<{
    requirementItemId: string;
    productId: string;
    quantityRequested: Prisma.Decimal;
  }>;
};

type Tx = Prisma.TransactionClient;

/**
 * F1 adapter: expand shared quantity map onto every recipient.
 * Preserves planned fallback for missing override keys.
 */
export function recipientsFromPlanned(args: {
  recipients: Array<{ id: string; name: string }>;
  items: DistributePreviewItem[];
  quantityByItemId: Map<string, Prisma.Decimal>;
}): DistributeRecipient[] {
  return args.recipients.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    items: args.items.map((item) => ({
      requirementItemId: item.id,
      productId: item.product.id,
      quantityRequested:
        args.quantityByItemId.get(item.id) ??
        new Prisma.Decimal(item.quantityPlanned),
    })),
  }));
}

/**
 * Create SupplierRequests inside an existing transaction.
 * Uses explicit per-recipient items — never invents planned qty for omitted lines.
 */
export async function distributeRequirementInTransaction(
  tx: Tx,
  args: {
    actor: ProvisionedAppUser;
    requirementId: string;
    brandId: string;
    brandName: string;
    mode: "ALL_MATCHING" | "SELECTED";
    items: DistributePreviewItem[];
    recipients: DistributeRecipient[];
    responseDeadline: Date | null;
    now?: Date;
  },
): Promise<{
  requestIds: string[];
  skippedSupplierIds: string[];
}> {
  const now = args.now ?? new Date();
  const requestIds: string[] = [];
  const skippedSupplierIds: string[] = [];

  if (args.items.length === 0) {
    throw new RequestDomainError("EMPTY_ITEMS", "Requirement has no line items.");
  }

  const itemById = new Map(args.items.map((i) => [i.id, i]));
  const activeRecipients = args.recipients.filter((r) => r.items.length > 0);
  if (activeRecipients.length === 0) {
    throw new RequestDomainError(
      "NO_RECIPIENTS",
      "No eligible suppliers to send to (active, matching, without an open request).",
    );
  }

  const locked = await lockSuppliers(tx, args.actor.companyId, activeRecipients.map(({ id }) => id));
  const suppliers = await tx.supplier.findMany({
    where: { companyId: args.actor.companyId, id: { in: locked.map(({ id }) => id) } },
    select: { id: true, status: true, supportsAllBrands: true, brands: { select: { brandId: true } } },
  });
  const eligibleIds = new Set(suppliers.filter((supplier) => supplierMatchesBrand({
    ...supplier, brandIds: supplier.brands.map(({ brandId }) => brandId),
  }, args.brandId)).map(({ id }) => id));
  if (args.mode === "SELECTED" && activeRecipients.some(({ id }) => !eligibleIds.has(id))) {
    throw new RequestDomainError("INVALID_SUPPLIER", "One or more selected suppliers are no longer eligible.");
  }
  if (!eligibleIds.size) {
    throw new RequestDomainError("NO_RECIPIENTS", "No eligible suppliers to send to.");
  }

  for (const supplier of activeRecipients) {
    if (!eligibleIds.has(supplier.id)) {
      skippedSupplierIds.push(supplier.id);
      continue;
    }
    for (const line of supplier.items) {
      const item = itemById.get(line.requirementItemId);
      if (!item) {
        throw new RequestDomainError(
          "VALIDATION",
          `Unknown requirement item on recipient: ${line.requirementItemId}`,
        );
      }
      if (!(Number(line.quantityRequested) > 0)) {
        throw new RequestDomainError(
          "VALIDATION",
          "Requested quantities must be greater than zero.",
        );
      }
    }

    const existing = await tx.supplierRequest.findFirst({
      where: {
        companyId: args.actor.companyId,
        requirementId: args.requirementId,
        supplierId: supplier.id,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
      },
      select: { id: true },
    });
    if (existing) {
      skippedSupplierIds.push(supplier.id);
      continue;
    }

    const requestId = createId();
    await tx.supplierRequest.create({
      data: {
        id: requestId,
        companyId: args.actor.companyId,
        requirementId: args.requirementId,
        supplierId: supplier.id,
        brandId: args.brandId,
        status: "NEW",
        responseDeadline: args.responseDeadline,
        sentAt: now,
        items: {
          create: supplier.items.map((line) => ({
            id: createId(),
            requirementItemId: line.requirementItemId,
            productId: line.productId,
            quantityRequested: line.quantityRequested,
          })),
        },
      },
    });
    requestIds.push(requestId);

    const supplierUsers = await tx.user.findMany({
      where: {
        companyId: args.actor.companyId,
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
        body: `A new request was sent for brand ${args.brandName}.`,
        entityType: "SupplierRequest",
        entityId: requestId,
      });
    }
  }

  if (requestIds.length === 0) {
    throw new RequestDomainError(
      "DUPLICATE_REQUEST",
      "All selected suppliers already have an active request.",
    );
  }

  await writeAuditLog({
    tx,
    actorUserId: args.actor.id,
    entityType: "Requirement",
    entityId: args.requirementId,
    action: "UPDATE",
    afterJson: {
      event: "SUPPLIER_REQUESTS_DISTRIBUTED",
      mode: args.mode,
      requestIds,
      supplierCount: requestIds.length,
      skippedSupplierIds,
      responseDeadline: args.responseDeadline?.toISOString() ?? null,
    },
  });

  return { requestIds, skippedSupplierIds };
}

export function buildQuantityByItemId(
  items: DistributePreviewItem[],
  overrides: QuantityOverride[] | undefined,
  acknowledgeOverQty: boolean,
): Map<string, Prisma.Decimal> {
  const map = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    map.set(item.id, new Prisma.Decimal(item.quantityPlanned));
  }
  if (!overrides?.length) return map;

  let over = false;
  for (const o of overrides) {
    const item = items.find((i) => i.id === o.requirementItemId);
    if (!item) {
      throw new RequestDomainError(
        "VALIDATION",
        `Unknown requirement item for quantity override: ${o.requirementItemId}`,
      );
    }
    if (!(o.quantityRequested > 0)) {
      throw new RequestDomainError(
        "VALIDATION",
        "Override quantities must be greater than zero.",
      );
    }
    if (o.quantityRequested > Number(item.quantityPlanned)) {
      over = true;
    }
    map.set(o.requirementItemId, new Prisma.Decimal(o.quantityRequested));
  }
  if (over && !acknowledgeOverQty) {
    throw new RequestDomainError(
      "VALIDATION",
      "Requested quantity exceeds planned requirement. Acknowledge the over-qty warning to continue.",
    );
  }
  return map;
}

/**
 * Over-planned check for explicit per-supplier recipients:
 * - any single requested qty > planned, or
 * - sum of requested qty across recipients for one item > planned.
 */
export function assertAcknowledgeOverQtyForRecipients(args: {
  items: DistributePreviewItem[];
  recipients: DistributeRecipient[];
  acknowledgeOverQty: boolean;
}) {
  const plannedById = new Map(
    args.items.map((i) => [i.id, Number(i.quantityPlanned)] as const),
  );
  const sumByItem = new Map<string, number>();
  let over = false;

  for (const recipient of args.recipients) {
    for (const line of recipient.items) {
      const planned = plannedById.get(line.requirementItemId);
      if (planned == null) {
        throw new RequestDomainError(
          "VALIDATION",
          `Unknown requirement item for recipient quantity: ${line.requirementItemId}`,
        );
      }
      const qty = Number(line.quantityRequested);
      if (!(qty > 0)) {
        throw new RequestDomainError(
          "VALIDATION",
          "Requested quantities must be greater than zero.",
        );
      }
      if (qty > planned) over = true;
      sumByItem.set(
        line.requirementItemId,
        (sumByItem.get(line.requirementItemId) ?? 0) + qty,
      );
    }
  }

  for (const [itemId, sum] of sumByItem) {
    const planned = plannedById.get(itemId) ?? 0;
    if (sum > planned) over = true;
  }

  if (over && !args.acknowledgeOverQty) {
    throw new RequestDomainError(
      "VALIDATION",
      "Requested quantity exceeds planned requirement (including supplier totals). Acknowledge the over-qty warning to continue.",
    );
  }
}
