import { describe, expect, it } from "vitest";

import {
  buildSupplierResponseSummary,
  offerNeedsPriceReview,
  offerReadyForAllocation,
  uniqueRequestCount,
} from "./supplier-responses-logic";

describe("supplier response dashboard logic", () => {
  it("counts distinct request ids only once", () => {
    expect(uniqueRequestCount(["a", "a", "b", "a"])).toBe(2);
    expect(uniqueRequestCount([])).toBe(0);
  });

  it("flags price review for quoted/counter/unconfirmed, not agreed", () => {
    expect(
      offerNeedsPriceReview({
        status: "SUBMITTED",
        unitPrice: 10,
        agreementStatus: "QUOTED",
      }),
    ).toBe(true);
    expect(
      offerNeedsPriceReview({
        status: "SUBMITTED",
        unitPrice: 10,
        agreementStatus: "COUNTER_PENDING",
      }),
    ).toBe(true);
    expect(
      offerNeedsPriceReview({
        status: "SUBMITTED",
        unitPrice: 10,
        agreementStatus: "STAFF_RECORDED_UNCONFIRMED",
      }),
    ).toBe(true);
    expect(
      offerNeedsPriceReview({
        status: "SUBMITTED",
        unitPrice: 10,
        agreementStatus: "SUPPLIER_CONFIRMED",
      }),
    ).toBe(false);
    expect(
      offerNeedsPriceReview({
        status: "SUBMITTED",
        unitPrice: 12,
        agreementStatus: null,
      }),
    ).toBe(true);
  });

  const now = new Date("2026-11-16T05:00:00.000Z");
  const future = new Date("2026-11-20T05:00:00.000Z");
  const past = new Date("2026-11-15T05:00:00.000Z");

  const baseReady = {
    status: "SUBMITTED",
    reserveExpiresAt: future,
    quantityDeclared: 40,
    quantityOrderedActive: 10,
    agreementStatus: "SUPPLIER_CONFIRMED" as const,
    remainingPlanQuantity: 20,
    now,
  };

  it("requires live reserve, remaining offer, uncovered plan, and agreed price", () => {
    expect(offerReadyForAllocation(baseReady)).toBe(true);

    expect(
      offerReadyForAllocation({
        ...baseReady,
        reserveExpiresAt: past,
      }),
    ).toBe(false);

    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 10,
        quantityOrderedActive: 10,
      }),
    ).toBe(false);

    expect(
      offerReadyForAllocation({
        ...baseReady,
        agreementStatus: "QUOTED",
      }),
    ).toBe(false);
  });

  it("fully covered requirement is not ready even with leftover offer qty", () => {
    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 20,
        quantityOrderedActive: 10,
        remainingPlanQuantity: 0,
      }),
    ).toBe(false);
  });

  it("partial shortage stays ready when eligible", () => {
    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 20,
        quantityOrderedActive: 5,
        remainingPlanQuantity: 5,
      }),
    ).toBe(true);
  });

  it("unconfirmed price is not ready", () => {
    expect(
      offerReadyForAllocation({
        ...baseReady,
        agreementStatus: "STAFF_RECORDED_UNCONFIRMED",
      }),
    ).toBe(false);
  });

  it("reserve expired is not ready", () => {
    expect(
      offerReadyForAllocation({
        ...baseReady,
        reserveExpiresAt: past,
        remainingPlanQuantity: 10,
      }),
    ).toBe(false);
  });

  it("confirmed PO covering plan removes readiness; cancel restoring plan restores it", () => {
    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 20,
        quantityOrderedActive: 10,
        remainingPlanQuantity: 0,
      }),
    ).toBe(false);

    // After cancel: net ordered drops → uncovered plan returns; offer qty freed.
    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 20,
        quantityOrderedActive: 0,
        remainingPlanQuantity: 10,
      }),
    ).toBe(true);
  });

  it("multiple suppliers share uncovered plan — covered by one removes readiness for both leftovers", () => {
    const supplierA = offerReadyForAllocation({
      ...baseReady,
      quantityDeclared: 20,
      quantityOrderedActive: 10,
      remainingPlanQuantity: 0,
    });
    const supplierB = offerReadyForAllocation({
      ...baseReady,
      quantityDeclared: 15,
      quantityOrderedActive: 0,
      remainingPlanQuantity: 0,
    });
    expect(supplierA).toBe(false);
    expect(supplierB).toBe(false);

    expect(
      offerReadyForAllocation({
        ...baseReady,
        quantityDeclared: 15,
        quantityOrderedActive: 0,
        remainingPlanQuantity: 5,
      }),
    ).toBe(true);
  });

  it("builds summary without double-counting multi-item requests", () => {
    const summary = buildSupplierResponseSummary({
      awaitingResponses: 3,
      responsesReceived: 5,
      needingRequestIds: ["r1", "r1", "r2"],
      readyRequestIds: ["r2", "r2", "r3", "r3"],
    });
    expect(summary).toEqual({
      awaitingResponses: 3,
      responsesReceived: 5,
      needingPriceReview: 2,
      readyForAllocation: 2,
    });
  });
});
