import { describe, expect, it } from "vitest";

import {
  itemNeedsAvailabilityAnswer,
  shouldCollapseAvailabilityEditor,
  supplierOfferStatusLabel,
  supplierRequestStatusLabel,
} from "./request-labels";

describe("supplier request labels", () => {
  it("maps request statuses to human labels", () => {
    expect(supplierRequestStatusLabel("NEW")).toBe("Need Reply");
    expect(supplierRequestStatusLabel("RESPONDED")).toBe("Response Sent");
    expect(supplierRequestStatusLabel("PARTIALLY_RESPONDED")).toBe(
      "Partly Answered",
    );
    expect(supplierRequestStatusLabel("SUPPLIER_CONFIRMED")).not.toBe(
      "Price Agreed",
    );
  });

  it("maps offer statuses without exposing raw enums as-is for common cases", () => {
    expect(supplierOfferStatusLabel("SUBMITTED")).toBe("Submitted");
    expect(supplierOfferStatusLabel("NOT_AVAILABLE")).toBe("Not available");
  });
});

describe("availability editor collapse", () => {
  it("collapses when every line is already answered", () => {
    expect(
      shouldCollapseAvailabilityEditor([
        { offer: { status: "SUBMITTED" } },
        { offer: { status: "NOT_AVAILABLE" } },
      ]),
    ).toBe(true);
  });

  it("stays open when any line is unanswered (partial response)", () => {
    expect(
      shouldCollapseAvailabilityEditor([
        { offer: { status: "SUBMITTED" } },
        { offer: null },
      ]),
    ).toBe(false);
    expect(
      shouldCollapseAvailabilityEditor([
        { offer: { status: "SUBMITTED" } },
        { offer: { status: "DRAFT" } },
      ]),
    ).toBe(false);
  });

  it("flags unanswered items including expired", () => {
    expect(itemNeedsAvailabilityAnswer({ offer: null })).toBe(true);
    expect(itemNeedsAvailabilityAnswer({ offer: { status: "EXPIRED" } })).toBe(
      true,
    );
    expect(
      itemNeedsAvailabilityAnswer({ offer: { status: "SUBMITTED" } }),
    ).toBe(false);
  });
});
