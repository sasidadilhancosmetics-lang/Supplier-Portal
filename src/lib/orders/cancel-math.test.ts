import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import {
  cancellableQuantity,
  lineStatusAfterCancel,
  purchaseOrderStatusAfterCancel,
} from "./cancel-math";

describe("cancel-math", () => {
  it("computes cancellable qty excluding verified and holds", () => {
    expect(
      cancellableQuantity({
        quantityOrdered: 100,
        quantityVerifiedReceived: 40,
        quantityCancelled: 10,
        submittedDeliveryHold: 5,
      }).toString(),
    ).toBe("45");
  });

  it("never returns negative cancellable", () => {
    expect(
      cancellableQuantity({
        quantityOrdered: 10,
        quantityVerifiedReceived: 10,
        quantityCancelled: 0,
      }).toString(),
    ).toBe("0");
  });

  it("derives line status after cancel", () => {
    expect(
      lineStatusAfterCancel({
        quantityOrdered: new Prisma.Decimal(10),
        quantityVerifiedReceived: new Prisma.Decimal(0),
        quantityCancelled: new Prisma.Decimal(10),
      }),
    ).toBe("CANCELLED");
    expect(
      lineStatusAfterCancel({
        quantityOrdered: new Prisma.Decimal(100),
        quantityVerifiedReceived: new Prisma.Decimal(40),
        quantityCancelled: new Prisma.Decimal(60),
      }),
    ).toBe("PARTIALLY_CANCELLED");
  });

  it("derives PO status after cancel", () => {
    expect(
      purchaseOrderStatusAfterCancel({
        allLinesFullyCancelledWithoutDelivery: true,
        anyVerifiedReceived: false,
      }),
    ).toBe("CANCELLED");
    expect(
      purchaseOrderStatusAfterCancel({
        allLinesFullyCancelledWithoutDelivery: false,
        anyVerifiedReceived: true,
      }),
    ).toBe("PARTIALLY_CANCELLED");
  });
});
