import { describe, expect, it } from "vitest";

import { formatCataloguePrice } from "./catalogue-price-format";

describe("formatCataloguePrice", () => {
  it.each([
    ["140.5", null, "LKR 140.50"],
    ["140", "2.0000", "LKR 140.00 · MOQ 2"],
    ["140.50", "2.5000", "LKR 140.50 · MOQ 2.5"],
    ["140.01", "2.2500", "LKR 140.01 · MOQ 2.25"],
    ["9999999999999999.99", "99999999999999.9999", "LKR 9999999999999999.99 · MOQ 99999999999999.9999"],
    ["0.01", "0.0001", "LKR 0.01 · MOQ 0.0001"],
  ])("formats %s with MOQ %s", (unitPrice, moq, label) => {
    expect(formatCataloguePrice({ unitPrice, moq })).toBe(label);
  });

  it("keeps the revision unit of measure between price and MOQ", () => {
    expect(formatCataloguePrice({ unitPrice: "140.5", moq: "2.0000", unitOfMeasure: "Each" }))
      .toBe("LKR 140.50 / Each · MOQ 2");
  });

  it("preserves the unsaved-price label", () => {
    expect(formatCataloguePrice({ unitPrice: null, moq: null })).toBe("Price not set");
  });
});
