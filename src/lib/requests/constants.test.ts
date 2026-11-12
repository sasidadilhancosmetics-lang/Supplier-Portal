import { describe, expect, it } from "vitest";

import { RESERVE_TTL_MS, computeReserveExpiresAt } from "./constants";

describe("seven-day reserve clock", () => {
  it("expires exactly 7 × 24 hours after reservedAt (UTC ms)", () => {
    const reservedAt = new Date("2026-11-12T06:00:00.000Z");
    const expires = computeReserveExpiresAt(reservedAt);
    expect(expires.toISOString()).toBe("2026-11-19T06:00:00.000Z");
    expect(expires.getTime() - reservedAt.getTime()).toBe(RESERVE_TTL_MS);
  });

  it("does not depend on local timezone offsets for the delta", () => {
    const reservedAt = new Date(Date.UTC(2026, 0, 1, 12, 30, 0));
    const expires = computeReserveExpiresAt(reservedAt);
    expect(expires.getTime()).toBe(reservedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  });
});
