import { describe, expect, it } from "vitest";

import { availabilitySplitsSchema, totalAvailability } from "./availability-splits";
import { saveAvailabilityDraftSchema, submitAvailabilitySchema } from "./schema";

const splits = [
  { quantity: "0.2002", date: "2026-12-05" },
  { quantity: "0.1001", date: "2026-12-04" },
];

describe("availability by date", () => {
  it("adds decimal quantities exactly and stores rows in date order", () => {
    expect(totalAvailability(splits)).toBe("0.3003");
    expect(availabilitySplitsSchema.parse(splits)).toEqual([...splits].reverse());
    expect(availabilitySplitsSchema.safeParse([splits[0]]).success).toBe(true);
  });

  it.each([
    [{ quantity: "1", date: "2026-02-30" }],
    [{ quantity: "0", date: "2026-12-05" }],
    [{ quantity: "0.00001", date: "2026-12-05" }],
    [splits[0], { quantity: "1", date: splits[0].date }],
    [{ quantity: "99999999999999.9999", date: "2026-12-06" }, splits[0]],
  ])("rejects invalid, duplicate-date or overflowing rows %#", (...rows) => {
    expect(availabilitySplitsSchema.safeParse(rows).success).toBe(false);
  });

  it("allows a draft without a quote but requires a quote when sending availability", () => {
    const raw = { supplierRequestId: "request", lines: [{ requestItemId: "line", splits }] };
    expect(saveAvailabilityDraftSchema.safeParse(raw).success).toBe(true);
    expect(submitAvailabilitySchema.safeParse(raw).success).toBe(false);
    expect(submitAvailabilitySchema.safeParse({
      ...raw,
      lines: [{ ...raw.lines[0], unitPrice: "10.50" }, { requestItemId: "pending" }],
    }).success).toBe(true);
  });
});
