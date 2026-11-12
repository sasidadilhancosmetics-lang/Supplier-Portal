import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

/** Cryptographically secure invite token (plaintext — return once, never store/log). */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteTokensEqual(aHash: string, bHash: string): boolean {
  const a = Buffer.from(aHash, "utf8");
  const b = Buffer.from(bHash, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const INVITE_TTL_MS = 1000 * 60 * 60 * 72; // 72 hours

export function inviteExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_MS);
}
