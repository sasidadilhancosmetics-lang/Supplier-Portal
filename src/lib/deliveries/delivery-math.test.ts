import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import {
  lineStatusAfterVerify,
  openOrdered,
  purchaseOrderStatusAfterVerify,
  remainingDeliverable,
  verifiedWouldExceedOpenOrdered,
} from "./delivery-math";

describe("delivery math", () => {
  it("computes open ordered and remaining deliverable with holds", () => {
    expect(openOrdered({ quantityOrdered: 100, quantityCancelled: 10 }).toString()).toBe(
      "90",
    );
    expect(
      remainingDeliverable({
        quantityOrdered: 100,
        quantityCancelled: 0,
        quantityVerifiedReceived: 40,
        submittedHold: 20,
      }).toString(),
    ).toBe("40");
    expect(
      remainingDeliverable({
        quantityOrdered: 10,
        quantityCancelled: 0,
        quantityVerifiedReceived: 10,
        submittedHold: 0,
      }).toString(),
    ).toBe("0");
  });

  it("does not count unverified submissions as received stock", () => {
    const rem = remainingDeliverable({
      quantityOrdered: 50,
      quantityCancelled: 0,
      quantityVerifiedReceived: 0,
      submittedHold: 50,
    });
    expect(rem.toString()).toBe("0");
  });

  it("marks lines fulfilled after full verification", () => {
    expect(
      lineStatusAfterVerify({
        quantityOrdered: new Prisma.Decimal(10),
        quantityVerifiedReceived: new Prisma.Decimal(10),
        quantityCancelled: new Prisma.Decimal(0),
      }),
    ).toBe("FULFILLED");
  });

  it("updates PO to partially delivered or delivered", () => {
    expect(
      purchaseOrderStatusAfterVerify({
        previousStatus: "CONFIRMED",
        lines: [
          {
            quantityOrdered: new Prisma.Decimal(10),
            quantityVerifiedReceived: new Prisma.Decimal(4),
            quantityCancelled: new Prisma.Decimal(0),
          },
        ],
      }),
    ).toBe("PARTIALLY_DELIVERED");

    expect(
      purchaseOrderStatusAfterVerify({
        previousStatus: "PARTIALLY_DELIVERED",
        lines: [
          {
            quantityOrdered: new Prisma.Decimal(10),
            quantityVerifiedReceived: new Prisma.Decimal(10),
            quantityCancelled: new Prisma.Decimal(0),
          },
        ],
      }),
    ).toBe("DELIVERED");
  });

  it("allows above-cap detection when submitted hold + verified exceed plan", () => {
    expect(
      remainingDeliverable({
        quantityOrdered: 10,
        quantityCancelled: 0,
        quantityVerifiedReceived: 6,
        submittedHold: 5,
      }).toString(),
    ).toBe("0");
  });

  it("rejects verified totals that would exceed net ordered", () => {
    expect(
      verifiedWouldExceedOpenOrdered({
        quantityOrdered: 10,
        quantityCancelled: 0,
        quantityVerifiedReceived: 7,
        quantityToVerify: 4,
      }),
    ).toBe(true);
    expect(
      verifiedWouldExceedOpenOrdered({
        quantityOrdered: 10,
        quantityCancelled: 2,
        quantityVerifiedReceived: 7,
        quantityToVerify: 1,
      }),
    ).toBe(false);
  });
});
