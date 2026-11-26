import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";

import {
  allocatePreviewLineTotal,
  allocatePreviewOrderTotal,
  formatOrderMoney,
  orderLinePriceView,
  orderPriceTotalsView,
  parseAllocateQuantityInput,
} from "./order-pricing";

describe("formatOrderMoney", () => {
  it("formats amounts with two decimal places and currency", () => {
    expect(formatOrderMoney(100, "LKR")).toBe("100.00 LKR");
    expect(formatOrderMoney("90.5", "LKR")).toBe("90.50 LKR");
  });
});

describe("orderLinePriceView", () => {
  it("computes line total from ordered qty × snapshotted unit price", () => {
    const view = orderLinePriceView({
      quantityOrdered: "10",
      unitPrice: "90.00",
      currencyCode: "LKR",
    });
    expect(view.hasPrice).toBe(true);
    expect(view.unitPriceLabel).toBe("90.00 LKR");
    expect(view.lineTotalLabel).toBe("900.00 LKR");
    expect(view.lineTotal?.equals(new Prisma.Decimal(900))).toBe(true);
  });

  it("shows Price not recorded for legacy null unitPrice", () => {
    const view = orderLinePriceView({
      quantityOrdered: 5,
      unitPrice: null,
    });
    expect(view.hasPrice).toBe(false);
    expect(view.unitPriceLabel).toBe("Price not recorded");
    expect(view.lineTotalLabel).toBe("Price not recorded");
    expect(view.lineTotal).toBeNull();
  });

  it("does not invent zero when price is missing", () => {
    const view = orderLinePriceView({
      quantityOrdered: 5,
      unitPrice: undefined,
    });
    expect(view.lineTotalLabel).not.toContain("0 ");
    expect(view.unitPriceLabel).toBe("Price not recorded");
  });
});

describe("orderPriceTotalsView", () => {
  it("sums multi-item order totals with Decimal safety", () => {
    const a = orderLinePriceView({
      quantityOrdered: "2",
      unitPrice: new Prisma.Decimal("10.25"),
    });
    const b = orderLinePriceView({
      quantityOrdered: "3",
      unitPrice: "5",
    });
    const totals = orderPriceTotalsView(
      [{ lineTotal: a.lineTotal }, { lineTotal: b.lineTotal }],
      "LKR",
    );
    expect(totals.allLinesPriced).toBe(true);
    expect(totals.totalLabel).toBe("35.50 LKR");
  });

  it("keeps recorded total when some lines lack price", () => {
    const priced = orderLinePriceView({
      quantityOrdered: "2",
      unitPrice: "50",
    });
    const totals = orderPriceTotalsView([
      { lineTotal: priced.lineTotal },
      { lineTotal: null },
    ]);
    expect(totals.hasAnyPrice).toBe(true);
    expect(totals.allLinesPriced).toBe(false);
    expect(totals.missingPriceCount).toBe(1);
    expect(totals.totalLabel).toBe("100.00 LKR");
  });

  it("reports Price not recorded when no lines have prices", () => {
    const totals = orderPriceTotalsView([
      { lineTotal: null },
      { lineTotal: null },
    ]);
    expect(totals.totalLabel).toBe("Price not recorded");
    expect(totals.hasAnyPrice).toBe(false);
  });
});

describe("allocate preview totals", () => {
  it("parses positive quantities and rejects empty/invalid", () => {
    expect(parseAllocateQuantityInput("10")?.toString()).toBe("10");
    expect(parseAllocateQuantityInput("")).toBeNull();
    expect(parseAllocateQuantityInput("0")).toBeNull();
    expect(parseAllocateQuantityInput("-1")).toBeNull();
    expect(parseAllocateQuantityInput("abc")).toBeNull();
  });

  it("computes line and order totals with Decimal safety", () => {
    const a = allocatePreviewLineTotal({
      quantityInput: "10",
      agreedUnitPrice: "90.5",
    });
    const b = allocatePreviewLineTotal({
      quantityInput: "2",
      agreedUnitPrice: "10",
    });
    expect(a?.equals(new Prisma.Decimal("905"))).toBe(true);
    const order = allocatePreviewOrderTotal([a, b, null]);
    expect(order?.equals(new Prisma.Decimal("925"))).toBe(true);
  });

  it("returns null line total without agreed price or qty", () => {
    expect(
      allocatePreviewLineTotal({
        quantityInput: "5",
        agreedUnitPrice: null,
      }),
    ).toBeNull();
    expect(
      allocatePreviewLineTotal({
        quantityInput: "",
        agreedUnitPrice: "90",
      }),
    ).toBeNull();
  });
});
