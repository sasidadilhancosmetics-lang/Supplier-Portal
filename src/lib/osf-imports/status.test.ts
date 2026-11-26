import { describe, expect, it } from "vitest";

import {
  isImportEditableStatus,
  recomputeImportReviewStatus,
} from "./status";

describe("recomputeImportReviewStatus", () => {
  it("returns READY_TO_CONFIRM when every keepable line is matched", () => {
    expect(
      recomputeImportReviewStatus([
        { mappingStatus: "MATCHED_SKU", quantityPlanned: 5 },
        { mappingStatus: "REJECTED_ZERO_QTY", quantityPlanned: 0 },
        { mappingStatus: "EXCLUDED", quantityPlanned: 3 },
      ]),
    ).toBe("READY_TO_CONFIRM");
  });

  it("returns NEEDS_REVIEW when unresolved lines remain", () => {
    expect(
      recomputeImportReviewStatus([
        { mappingStatus: "MATCHED_SKU", quantityPlanned: 5 },
        { mappingStatus: "UNKNOWN_SKU", quantityPlanned: 2 },
      ]),
    ).toBe("NEEDS_REVIEW");
  });

  it("returns NEEDS_REVIEW when nothing is matched", () => {
    expect(
      recomputeImportReviewStatus([
        { mappingStatus: "EXCLUDED", quantityPlanned: 1 },
      ]),
    ).toBe("NEEDS_REVIEW");
  });
});

describe("isImportEditableStatus", () => {
  it("allows review statuses and blocks confirmed", () => {
    expect(isImportEditableStatus("NEEDS_REVIEW")).toBe(true);
    expect(isImportEditableStatus("READY_TO_CONFIRM")).toBe(true);
    expect(isImportEditableStatus("CONFIRMED")).toBe(false);
    expect(isImportEditableStatus("FAILED")).toBe(false);
  });
});
