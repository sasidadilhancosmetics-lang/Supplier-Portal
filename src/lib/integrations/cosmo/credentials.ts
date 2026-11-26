import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

import { hashIntegrationToken } from "./crypto";
import { CosmoIngestError } from "./errors";

export type AuthenticatedIntegrationCredential = {
  id: string;
  companyId: string;
  cosmoCompanyId: string;
  name: string;
  tokenPrefix: string;
};

function parseBearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) {
    throw new CosmoIngestError(
      "UNAUTHORIZED",
      "Missing Authorization bearer token.",
    );
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw new CosmoIngestError(
      "UNAUTHORIZED",
      "Authorization header must be Bearer <token>.",
    );
  }
  return match[1];
}

/**
 * Resolve IntegrationCredential from the Bearer token.
 * Never logs the raw token. companyId comes only from the credential row.
 */
export async function authenticateIntegrationCredential(args: {
  authorizationHeader: string | null;
  now?: Date;
  tx?: Prisma.TransactionClient;
}): Promise<AuthenticatedIntegrationCredential> {
  const token = parseBearerToken(args.authorizationHeader);
  const tokenHash = hashIntegrationToken(token);
  const client = args.tx ?? prisma;
  const now = args.now ?? new Date();

  const credential = await client.integrationCredential.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      companyId: true,
      cosmoCompanyId: true,
      name: true,
      tokenPrefix: true,
      isActive: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!credential) {
    throw new CosmoIngestError("UNAUTHORIZED", "Invalid integration credential.");
  }
  if (!credential.isActive || credential.revokedAt != null) {
    throw new CosmoIngestError(
      "UNAUTHORIZED",
      "Integration credential is revoked or inactive.",
    );
  }
  if (credential.expiresAt != null && credential.expiresAt.getTime() <= now.getTime()) {
    throw new CosmoIngestError(
      "UNAUTHORIZED",
      "Integration credential has expired.",
    );
  }

  return {
    id: credential.id,
    companyId: credential.companyId,
    cosmoCompanyId: credential.cosmoCompanyId,
    name: credential.name,
    tokenPrefix: credential.tokenPrefix,
  };
}

/** Body cosmoCompanyId must match the credential binding. Never trust for writes. */
export function assertCosmoCompanyBinding(
  credential: AuthenticatedIntegrationCredential,
  bodyCosmoCompanyId: string,
) {
  if (credential.cosmoCompanyId !== bodyCosmoCompanyId) {
    throw new CosmoIngestError(
      "COMPANY_MISMATCH",
      "source.cosmoCompanyId does not match the credential binding.",
    );
  }
}

export async function touchCredentialLastUsed(args: {
  credentialId: string;
  now?: Date;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  await client.integrationCredential.update({
    where: { id: args.credentialId },
    data: { lastUsedAt: args.now ?? new Date() },
  });
}
