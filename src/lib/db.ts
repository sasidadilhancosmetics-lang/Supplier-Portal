import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { Prisma, PrismaClient } from "@/generated/prisma/client";

// Neon serverless driver needs an explicit WebSocket constructor in Node.js.
neonConfig.webSocketConstructor = ws;

/**
 * Fingerprint generated client scalar fields so a long-lived Next.js process
 * rebuilds PrismaClient after `prisma generate` (HMR can leave a stale singleton).
 */
const PRISMA_CLIENT_FINGERPRINT = Object.keys(
  Prisma.SupplierRequestScalarFieldEnum,
)
  .sort()
  .join(",");

/**
 * Server-only Prisma Client for Neon (pooled DATABASE_URL + PrismaNeon adapter).
 * Do not import this module from Client Components or browser code.
 */
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as typeof globalThis & {
  __supplierPortalPrisma?: PrismaClient;
  __supplierPortalPrismaFingerprint?: string;
};

function getPrismaClient(): PrismaClient {
  if (
    globalForPrisma.__supplierPortalPrisma &&
    globalForPrisma.__supplierPortalPrismaFingerprint === PRISMA_CLIENT_FINGERPRINT
  ) {
    return globalForPrisma.__supplierPortalPrisma;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__supplierPortalPrisma = client;
    globalForPrisma.__supplierPortalPrismaFingerprint = PRISMA_CLIENT_FINGERPRINT;
  }
  return client;
}

export const prisma = getPrismaClient();
