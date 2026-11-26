import { describe, expect, it } from "vitest";

import {
  allocationIneligibilityReason,
  isOfferAllocatableNow,
} from "./eligibility";

describe("offer allocation eligibility", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const future = new Date("2026-06-08T12:00:00.000Z");

  it("allows SUBMITTED offers with live reserve and remaining qty", () => {
    expect(
      isOfferAllocatableNow(
        {
          status: "SUBMITTED",
          quantityDeclared: 10,
          quantityOrderedActive: 2,
          reserveExpiresAt: future,
        },
        now,
      ),
    ).toBe(true);
  });

  it("rejects expired, cancelled, unavailable, and fully allocated offers", () => {
    expect(
      isOfferAllocatableNow(
        {
          status: "EXPIRED",
          quantityDeclared: 10,
          quantityOrderedActive: 0,
          reserveExpiresAt: future,
        },
        now,
      ),
    ).toBe(false);
    expect(
      allocationIneligibilityReason(
        {
          status: "CANCELLED",
          quantityDeclared: 10,
          quantityOrderedActive: 0,
          reserveExpiresAt: future,
        },
        now,
      ),
    ).toBe("Offer cancelled");
    expect(
      allocationIneligibilityReason(
        {
          status: "NOT_AVAILABLE",
          quantityDeclared: 0,
          quantityOrderedActive: 0,
          reserveExpiresAt: null,
        },
        now,
      ),
    ).toBe("Marked not available");
    expect(
      allocationIneligibilityReason(
        {
          status: "SUBMITTED",
          quantityDeclared: 10,
          quantityOrderedActive: 10,
          reserveExpiresAt: future,
        },
        now,
      ),
    ).toBe("Fully allocated");
  });
});
