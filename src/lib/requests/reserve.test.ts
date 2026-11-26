import { describe, expect, it } from "vitest";

import { computeReserveExpiresAt } from "./constants";
import { isLiveReserve, resolveReserveOnSubmit } from "./reserve";

describe("isLiveReserve", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("labels only future SUBMITTED reserves as active", () => {
    expect(
      isLiveReserve(
        {
          status: "SUBMITTED",
          reserveExpiresAt: new Date("2026-11-19T12:00:00.000Z"),
        },
        now,
      ),
    ).toBe(true);
  });

  it("never labels an expired reserve as active", () => {
    expect(
      isLiveReserve(
        {
          status: "SUBMITTED",
          reserveExpiresAt: new Date("2026-11-12T11:59:59.000Z"),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isLiveReserve(
        {
          status: "EXPIRED",
          reserveExpiresAt: new Date("2026-11-19T12:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("does not use response deadline semantics (null expiry is inactive)", () => {
    expect(
      isLiveReserve({ status: "SUBMITTED", reserveExpiresAt: null }, now),
    ).toBe(false);
  });
});

describe("resolveReserveOnSubmit", () => {
  const now = new Date("2026-11-12T06:56:57.784Z");
  const originalReservedAt = new Date("2026-11-10T06:56:57.784Z");
  const originalExpires = computeReserveExpiresAt(originalReservedAt);

  it("starts a fresh 7×24h UTC reserve on new positive submission", () => {
    const result = resolveReserveOnSubmit({
      nextStatus: "SUBMITTED",
      quantity: 10,
      existing: null,
      now,
    });
    expect(result.startedFreshClock).toBe(true);
    expect(result.reservedAt?.toISOString()).toBe(now.toISOString());
    expect(result.reserveExpiresAt?.toISOString()).toBe(
      computeReserveExpiresAt(now).toISOString(),
    );
  });

  it("does not extend an active SUBMITTED reserve on update", () => {
    const result = resolveReserveOnSubmit({
      nextStatus: "SUBMITTED",
      quantity: 20,
      existing: {
        status: "SUBMITTED",
        reservedAt: originalReservedAt,
        reserveExpiresAt: originalExpires,
      },
      now,
    });
    expect(result.startedFreshClock).toBe(false);
    expect(result.reservedAt?.toISOString()).toBe(
      originalReservedAt.toISOString(),
    );
    expect(result.reserveExpiresAt?.toISOString()).toBe(
      originalExpires.toISOString(),
    );
  });

  it("starts a fresh clock after EXPIRED / CANCELLED / NOT_AVAILABLE", () => {
    for (const status of ["EXPIRED", "CANCELLED", "NOT_AVAILABLE"] as const) {
      const result = resolveReserveOnSubmit({
        nextStatus: "SUBMITTED",
        quantity: 5,
        existing: {
          status,
          reservedAt: originalReservedAt,
          reserveExpiresAt: originalExpires,
        },
        now,
      });
      expect(result.startedFreshClock).toBe(true);
      expect(result.reserveExpiresAt?.toISOString()).toBe(
        computeReserveExpiresAt(now).toISOString(),
      );
    }
  });

  it("clears reserve when marking not available", () => {
    const result = resolveReserveOnSubmit({
      nextStatus: "NOT_AVAILABLE",
      quantity: 0,
      existing: {
        status: "SUBMITTED",
        reservedAt: originalReservedAt,
        reserveExpiresAt: originalExpires,
      },
      now,
    });
    expect(result.reservedAt).toBeNull();
    expect(result.reserveExpiresAt).toBeNull();
    expect(result.startedFreshClock).toBe(false);
  });
});
