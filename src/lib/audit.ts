import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

export type AuditEntityType =
  | "Supplier"
  | "Product"
  | "Requirement"
  | "Brand"
  | "PurchaseOrder"
  | "SupplierRequest"
  | "OsfImport"
  | "Delivery"
  | "Grn"
  | "OutboundIntegrationConnection";

type AuditInput = {
  /** Null for server-to-server integration actors (no Portal User). */
  actorUserId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

/** Generic AuditLog writer for Stage 5A+ entities. */
export async function writeAuditLog(input: AuditInput) {
  const client = input.tx ?? prisma;
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.beforeJson,
      afterJson: input.afterJson,
    },
  });
}
