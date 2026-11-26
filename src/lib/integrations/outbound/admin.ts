import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { encryptCredentials } from "./credentials";
import { OutboundIntegrationError } from "./errors";
import { mockMessages, runMockProviderTest, type MockResult } from "./mock-provider";
import {
  canonicalOrigin,
  connectionIdSchema,
  connectionMutationSchema,
  createConnectionSchema,
  mockTestSchema,
  requireApprovedOrigin,
} from "./schema";

const connectionSelect = {
  id: true,
  provider: true,
  origin: true,
  label: true,
  enabled: true,
  configVersion: true,
  credentialRotatedAt: true,
} as const satisfies Prisma.OutboundIntegrationConnectionSelect;

const entityType = "OutboundIntegrationConnection";
const mockAction = "INTEGRATION_MOCK_TESTED";
const auditPageSize = 25;
const maxAuditPage = 1_000;
const auditPageSchema = z.coerce.number().int().min(1).max(maxAuditPage);
const auditOrder: Prisma.AuditLogOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];
const actions = {
  INTEGRATION_CREATED: "Connection added",
  INTEGRATION_RENAMED: "Connection renamed",
  INTEGRATION_ENABLED: "Connection enabled",
  INTEGRATION_DISABLED: "Connection disabled",
  INTEGRATION_CREDENTIALS_REPLACED: "Credentials replaced",
  INTEGRATION_MOCK_TESTED: "Mock connection test",
} as const;

function isUniqueConflict(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
}

async function findConnection(
  db: Prisma.TransactionClient,
  companyId: string,
  id: string,
) {
  const connection = await db.outboundIntegrationConnection.findFirst({
    where: { id, companyId },
    select: connectionSelect,
  });
  if (!connection) throw new OutboundIntegrationError("NOT_FOUND");
  return connection;
}

function verifiedVersion(connection: { configVersion: number }, expectedVersion: number) {
  if (connection.configVersion !== expectedVersion) {
    throw new OutboundIntegrationError("STALE_VERSION");
  }
}

function companyAuditScope(companyId: string): Prisma.AuditLogWhereInput {
  return { entityType, afterJson: { path: ["companyId"], equals: companyId } };
}

function readMockAudit(event: { afterJson: Prisma.JsonValue; createdAt: Date } | null) {
  const value = event?.afterJson;
  if (
    !event || !value || typeof value !== "object" || Array.isArray(value) ||
    typeof value.configVersion !== "number" ||
    typeof value.result !== "string" || !Object.hasOwn(mockMessages, value.result)
  ) return null;
  return { configVersion: value.configVersion, result: value.result as MockResult, createdAt: event.createdAt };
}

export async function listAdminIntegrations() {
  const { companyId } = await requireAdmin();
  const [connections, cosmo] = await Promise.all([
    prisma.outboundIntegrationConnection.findMany({
      where: { companyId },
      select: connectionSelect,
      orderBy: [{ provider: "asc" }, { label: "asc" }, { id: "asc" }],
    }),
    prisma.integrationCredential.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        isActive: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);
  const latestMockByConnection = new Map<string, ReturnType<typeof readMockAudit>>();
  if (connections.length > 0) {
    const results = await prisma.auditLog.findMany({
      where: {
        ...companyAuditScope(companyId),
        entityId: { in: connections.map(({ id }) => id) },
        action: mockAction,
      },
      distinct: ["entityId"],
      orderBy: auditOrder,
      select: { entityId: true, afterJson: true, createdAt: true },
    });
    for (const result of results) latestMockByConnection.set(result.entityId, readMockAudit(result));
  }
  const now = new Date();
  return {
    connections: connections.map((connection) => ({
      ...connection,
      lastMock: latestMockByConnection.get(connection.id) ?? null,
    })),
    cosmo: cosmo.map(({ id, name, isActive, expiresAt, revokedAt, lastUsedAt }) => ({
      id, name, expiresAt, lastUsedAt,
      status: revokedAt ? "Revoked" : !isActive ? "Inactive" : expiresAt && expiresAt <= now ? "Expired" : "Active",
    })),
  };
}

export async function getAdminIntegration(rawId: string, rawPage?: string) {
  const { companyId } = await requireAdmin();
  const id = connectionIdSchema.safeParse(rawId);
  if (!id.success) throw new OutboundIntegrationError("NOT_FOUND");
  const connection = await findConnection(prisma, companyId, id.data);
  const where = { ...companyAuditScope(companyId), entityId: connection.id };
  const parsedPage = auditPageSchema.safeParse(rawPage);
  const page = parsedPage.success ? parsedPage.data : 1;
  const [history, latestMock] = await Promise.all([
    prisma.auditLog.findMany({
      where: { ...where, action: { in: Object.keys(actions) } },
      orderBy: auditOrder,
      skip: (page - 1) * auditPageSize,
      take: auditPageSize + 1,
      select: { id: true, action: true, createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { ...where, action: mockAction },
      orderBy: auditOrder,
      select: { afterJson: true, createdAt: true },
    }),
  ]);
  return {
    connection,
    history: history.slice(0, auditPageSize)
      .map(({ id, action, createdAt }) => ({ id, label: actions[action as keyof typeof actions], createdAt })),
    historyPage: page,
    hasMoreHistory: page < maxAuditPage && history.length > auditPageSize,
    lastMock: readMockAudit(latestMock),
  };
}

export async function createAdminIntegration(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = createConnectionSchema.safeParse(raw);
  if (!parsed.success) throw new OutboundIntegrationError("INVALID_INPUT");
  const { label, provider } = parsed.data;
  const origin = canonicalOrigin(provider, parsed.data.origin);
  requireApprovedOrigin(admin.companyId, provider, origin);

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.outboundIntegrationConnection.create({
        data: { companyId: admin.companyId, provider, label, origin },
        select: { id: true, configVersion: true },
      });
      await writeAuditLog({
        actorUserId: admin.id, entityType, entityId: row.id,
        action: "INTEGRATION_CREATED",
        afterJson: { companyId: admin.companyId, provider, configVersion: row.configVersion },
        tx,
      });
      return { id: row.id };
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new OutboundIntegrationError("DUPLICATE_ORIGIN");
    throw error;
  }
}

export async function updateAdminIntegration(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = connectionMutationSchema.safeParse(raw);
  if (!parsed.success) throw new OutboundIntegrationError("INVALID_INPUT");
  const input = parsed.data;

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await findConnection(tx, admin.companyId, input.id);
      verifiedVersion(row, input.expectedVersion);

      let action: keyof typeof actions;
      let data: Prisma.OutboundIntegrationConnectionUpdateManyMutationInput;
      if (input.kind === "rename") {
        if (input.label === row.label) return;
        action = "INTEGRATION_RENAMED";
        data = { label: input.label };
      } else if (input.kind === "enabled") {
        if (input.enabled === row.enabled) return;
        if (input.enabled) {
          if (!row.credentialRotatedAt) throw new OutboundIntegrationError("CREDENTIALS_REQUIRED");
          requireApprovedOrigin(admin.companyId, row.provider, row.origin);
        }
        action = input.enabled ? "INTEGRATION_ENABLED" : "INTEGRATION_DISABLED";
        data = { enabled: input.enabled };
      } else {
        requireApprovedOrigin(admin.companyId, row.provider, row.origin);
        action = "INTEGRATION_CREDENTIALS_REPLACED";
        data = encryptCredentials(
          { id: row.id, companyId: admin.companyId, provider: row.provider, origin: row.origin },
          { identifier: input.identifier, secret: input.secret },
        );
      }

      const updated = await tx.outboundIntegrationConnection.updateMany({
        where: { id: row.id, companyId: admin.companyId, configVersion: input.expectedVersion },
        data: { ...data, configVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new OutboundIntegrationError("STALE_VERSION");
      await writeAuditLog({
        actorUserId: admin.id, entityType, entityId: row.id, action,
        afterJson: { companyId: admin.companyId, provider: row.provider, configVersion: input.expectedVersion + 1 },
        tx,
      });
    });
  } catch (error) {
    if (input.kind === "enabled" && input.enabled && isUniqueConflict(error)) {
      throw new OutboundIntegrationError("SHOPIFY_ALREADY_ENABLED");
    }
    throw error;
  }
}

export async function testAdminIntegration(raw: unknown): Promise<MockResult> {
  const admin = await requireAdmin();
  const parsed = mockTestSchema.safeParse(raw);
  if (!parsed.success) throw new OutboundIntegrationError("INVALID_INPUT");
  const connection = await findConnection(prisma, admin.companyId, parsed.data.id);
  verifiedVersion(connection, parsed.data.expectedVersion);
  const result = runMockProviderTest({
    provider: connection.provider,
    origin: connection.origin,
    credentialsConfigured: connection.credentialRotatedAt !== null,
  });
  await writeAuditLog({
    actorUserId: admin.id, entityType, entityId: connection.id, action: mockAction,
    afterJson: { companyId: admin.companyId, provider: connection.provider, configVersion: connection.configVersion, result },
  });
  return result;
}
