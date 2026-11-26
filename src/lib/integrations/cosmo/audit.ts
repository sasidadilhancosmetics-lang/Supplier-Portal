import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { writeAuditLog } from "@/lib/audit";

/**
 * Integration-origin audit rows: actorUserId is null and afterJson always
 * includes actorKind=INTEGRATION so staff UIs can distinguish them from humans.
 */
export async function writeCosmoIntegrationAudit(args: {
  tx?: Prisma.TransactionClient;
  entityType: "OsfImport" | "Requirement";
  entityId: string;
  action: string;
  credentialId: string;
  afterJson: Record<string, unknown>;
}) {
  await writeAuditLog({
    tx: args.tx,
    actorUserId: null,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    afterJson: {
      actorKind: "INTEGRATION",
      integrationCredentialId: args.credentialId,
      source: "COSMO_OSF_PUSH",
      ...args.afterJson,
    },
  });
}
