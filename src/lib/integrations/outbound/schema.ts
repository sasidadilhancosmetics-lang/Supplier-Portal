import "server-only";

import { isIP } from "node:net";
import { z } from "zod";

import { OutboundIntegrationError } from "./errors";

export const providerSchema = z.enum(["ERP_NEXT", "SHOPIFY"]);
export type OutboundProvider = z.infer<typeof providerSchema>;

export const connectionIdSchema = z.string().min(1).max(128);
const labelSchema = z.string().trim().min(1).max(100);
const mutationIdentity = {
  id: connectionIdSchema,
  expectedVersion: z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)])
    .pipe(z.number().int().min(1).max(2_147_483_647)),
};

export const createConnectionSchema = z.strictObject({
  provider: providerSchema,
  label: labelSchema,
  origin: z.string().trim().min(1).max(270),
});

const credentialPart = z.string().min(1).max(2048).refine(
  (value) => value.trim() === value && value.length > 0,
);

export const connectionMutationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...mutationIdentity, kind: z.literal("rename"), label: labelSchema }),
  z.strictObject({ ...mutationIdentity, kind: z.literal("enabled"), enabled: z.boolean() }),
  z.strictObject({
    ...mutationIdentity,
    kind: z.literal("credentials"),
    identifier: credentialPart,
    secret: credentialPart,
  }),
]);

export const mockTestSchema = z.strictObject(mutationIdentity);

const hostLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const shopifyHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;

export function canonicalOrigin(provider: OutboundProvider, input: string): string {
  const candidate = provider === "SHOPIFY" && !input.includes("://")
    ? `https://${input}`
    : input;
  const match = /^https:\/\/([a-z0-9.-]+)\/?$/i.exec(candidate);
  const host = match?.[1].toLowerCase();
  if (
    !host ||
    host.length > 253 ||
    isIP(host) ||
    !host.includes(".") ||
    host.split(".").some((label) => !hostLabel.test(label)) ||
    !URL.canParse(`https://${host}`) ||
    new URL(`https://${host}`).hostname !== host ||
    (provider === "SHOPIFY" && !shopifyHost.test(host))
  ) {
    throw new OutboundIntegrationError("INVALID_INPUT");
  }
  return `https://${host}`;
}

const allowlistSchema = z.record(
  z.string(),
  z.strictObject({
    ERP_NEXT: z.array(z.string()).optional(),
    SHOPIFY: z.array(z.string()).optional(),
  }),
);

export function requireApprovedOrigin(
  companyId: string,
  provider: OutboundProvider,
  origin: string,
) {
  try {
    const allowlist = allowlistSchema.parse(
      JSON.parse(process.env.PORTAL_OUTBOUND_ORIGINS_JSON ?? "{}"),
    );
    const companyOrigins = Object.hasOwn(allowlist, companyId)
      ? allowlist[companyId][provider]
      : undefined;
    if (companyOrigins?.some((allowed) => canonicalOrigin(provider, allowed) === origin)) return;
  } catch {
    // Invalid deployment configuration fails closed without exposing its contents.
  }
  throw new OutboundIntegrationError("ORIGIN_NOT_APPROVED");
}
