import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 hex of the raw bearer token. Plain token is never stored. */
export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Non-secret prefix for staff identification (first 8 chars of token). */
export function integrationTokenPrefix(token: string): string {
  return token.slice(0, 8);
}

export function tokenHashesEqual(aHash: string, bHash: string): boolean {
  const a = Buffer.from(aHash, "utf8");
  const b = Buffer.from(bHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sha256Hex(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}
