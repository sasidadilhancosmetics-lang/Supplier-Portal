import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

type AuditInput = {
  actorUserId: string;
  entityId: string;
  action:
    | "CREATE"
    | "UPDATE"
    | "STATUS_CHANGE"
    | "BRANDS_CHANGE"
    | "EXTERNAL_ID_CHANGE";
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

export async function writeSupplierAuditLog(input: AuditInput) {
  const client = input.tx ?? prisma;
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      entityType: "Supplier",
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.beforeJson,
      afterJson: input.afterJson,
    },
  });
}
