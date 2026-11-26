import { describe, expect, it } from "vitest";

import {
  editableUnitPriceDefault,
  shouldCollapseAvailabilityEditor,
} from "@/lib/supplier/request-labels";

describe("editableUnitPriceDefault", () => {
  it("does not prefill the company counter while COUNTER_PENDING", () => {
    expect(
      editableUnitPriceDefault({
        status: "SUBMITTED",
        unitPrice: "90",
        supplierQuotedUnitPrice: "100",
        priceAgreement: { status: "COUNTER_PENDING", unitPrice: "90" },
      }),
    ).toBe("100");
  });

  it("falls back to empty when counter pending and no supplier quote known", () => {
    expect(
      editableUnitPriceDefault({
        status: "SUBMITTED",
        unitPrice: "90",
        supplierQuotedUnitPrice: null,
        priceAgreement: { status: "COUNTER_PENDING", unitPrice: "90" },
      }),
    ).toBe("");
  });

  it("uses agreed price after SUPPLIER_CONFIRMED", () => {
    expect(
      editableUnitPriceDefault({
        status: "SUBMITTED",
        unitPrice: "90",
        supplierQuotedUnitPrice: "100",
        priceAgreement: { status: "SUPPLIER_CONFIRMED", unitPrice: "90" },
      }),
    ).toBe("90");
  });
});

describe("mixed item states", () => {
  it("keeps editor open when one item is confirmed and another unanswered", () => {
    expect(
      shouldCollapseAvailabilityEditor([
        { offer: { status: "SUBMITTED" } },
        { offer: null },
      ]),
    ).toBe(false);
  });

  it("collapses only when all items answered including confirmed lines", () => {
    expect(
      shouldCollapseAvailabilityEditor([
        { offer: { status: "SUBMITTED" } },
        { offer: { status: "SUBMITTED" } },
      ]),
    ).toBe(true);
  });
});
