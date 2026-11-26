import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import {
  remainingOffer,
  remainingPlan,
  splitAgainstPlan,
} from "./allocation-math";

describe("allocation math", () => {
  it("computes remaining plan with floor at zero", () => {
    expect(remainingPlan(100, 40).toString()).toBe("60");
    expect(remainingPlan(100, 100).toString()).toBe("0");
    expect(remainingPlan(100, 120).toString()).toBe("0");
  });

  it("recomputes uncovered after confirmed order then cancellation", () => {
    const planned = 10;
    const afterConfirm = remainingPlan(planned, 10);
    expect(afterConfirm.toString()).toBe("0");
    // Cancel releases net ordered (ordered − cancelled).
    const afterCancel = remainingPlan(planned, 0);
    expect(afterCancel.toString()).toBe("10");
  });

  it("allows explicit above-plan split when plan is already covered", () => {
    const split = splitAgainstPlan(5, new Prisma.Decimal(0));
    expect(split.inPlan.toString()).toBe("0");
    expect(split.abovePlan.toString()).toBe("5");
  });

  it("remaining offer requires live SUBMITTED reserve", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const future = new Date("2026-06-08T12:00:00.000Z");
    expect(
      remainingOffer({
        status: "SUBMITTED",
        quantityDeclared: 50,
        quantityOrderedActive: 10,
        reserveExpiresAt: future,
        now,
      }).toString(),
    ).toBe("40");
    expect(
      remainingOffer({
        status: "EXPIRED",
        quantityDeclared: 50,
        quantityOrderedActive: 0,
        reserveExpiresAt: future,
        now,
      }).toString(),
    ).toBe("0");
    expect(
      remainingOffer({
        status: "SUBMITTED",
        quantityDeclared: 50,
        quantityOrderedActive: 0,
        reserveExpiresAt: new Date("2026-05-01T12:00:00.000Z"),
        now,
      }).toString(),
    ).toBe("0");
  });

  it("splits against running remaining plan", () => {
    const first = splitAgainstPlan(80, new Prisma.Decimal(100));
    expect(first.inPlan.toString()).toBe("80");
    expect(first.abovePlan.toString()).toBe("0");
    const second = splitAgainstPlan(50, first.nextRemaining);
    expect(second.inPlan.toString()).toBe("20");
    expect(second.abovePlan.toString()).toBe("30");
  });
});
