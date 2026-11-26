import { describe, expect, it } from "vitest";

import { buildSupplierOrderQuantitySummary } from "./supplier-order-summary";

describe("buildSupplierOrderQuantitySummary", () => {
  it("shows fully delivered progress from real quantities", () => {
    const summary = buildSupplierOrderQuantitySummary({
      items: [
        {
          orderItemId: "oi1",
          quantityOrdered: "10",
          quantityCancelled: "0",
          quantityVerifiedReceived: "10",
          unitPrice: "100",
        },
      ],
      currencyCode: "LKR",
    });

    expect(summary.orderedQty).toBe("10");
    expect(summary.receivedQty).toBe("10");
    expect(summary.remainingToReceive).toBe("0");
    expect(summary.availableToSchedule).toBe("0");
    expect(summary.isFullyDelivered).toBe(true);
    expect(summary.hasRecordedPrice).toBe(true);
  });

  it("distinguishes remaining to receive vs available to schedule when holds exist", () => {
    const holds = new Map([["oi1", 4]]);
    const summary = buildSupplierOrderQuantitySummary({
      items: [
        {
          orderItemId: "oi1",
          quantityOrdered: "10",
          quantityCancelled: "0",
          quantityVerifiedReceived: "3",
          unitPrice: null,
        },
      ],
      holdsByOrderItemId: holds,
    });

    expect(summary.remainingToReceive).toBe("7");
    expect(summary.availableToSchedule).toBe("3");
    expect(summary.hasRecordedPrice).toBe(false);
    expect(summary.orderValueLabel).toBe("Price not recorded");
  });
});
