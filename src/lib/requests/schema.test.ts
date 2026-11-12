import { describe, expect, it } from "vitest";

import {
  availabilityFieldErrorsFromZod,
  distributeRequirementSchema,
  saveAvailabilityDraftSchema,
  submitAvailabilitySchema,
} from "./schema";

describe("distributeRequirementSchema", () => {
  it("accepts all-matching with optional deadline", () => {
    const parsed = distributeRequirementSchema.parse({
      requirementId: "req_1",
      mode: "ALL_MATCHING",
      responseDeadline: "2026-11-20T12:00",
    });
    expect(parsed.mode).toBe("ALL_MATCHING");
    expect(parsed.responseDeadline).toBe("2026-11-20T12:00");
  });

  it("rejects invalid deadline", () => {
    const result = distributeRequirementSchema.safeParse({
      requirementId: "req_1",
      mode: "SELECTED",
      supplierIds: ["s1"],
      responseDeadline: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});

describe("availability schemas", () => {
  it("allows unanswered draft lines (empty qty stays null, not 0)", () => {
    const parsed = saveAvailabilityDraftSchema.parse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          quantityDeclared: "",
          availableDate: "2026-11-20",
          notAvailable: false,
          expectedVersion: "",
        },
      ],
    });
    expect(parsed.lines[0]?.quantityDeclared).toBeNull();
    expect(parsed.lines[0]?.expectedVersion).toBeUndefined();
    expect(parsed.lines[0]?.availableDate).toBe("2026-11-20");
  });

  it("does not treat blank expectedVersion as 0 (regression)", () => {
    const result = saveAvailabilityDraftSchema.safeParse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          quantityDeclared: "",
          notAvailable: false,
          expectedVersion: "",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines[0]?.expectedVersion).toBeUndefined();
    }
  });

  it("accepts explicit zero quantity as a number (NOT_AVAILABLE path)", () => {
    const parsed = submitAvailabilitySchema.parse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          quantityDeclared: "0",
          notAvailable: false,
        },
      ],
    });
    expect(parsed.lines[0]?.quantityDeclared).toBe(0);
    expect(parsed.lines[0]?.notAvailable).toBe(false);
  });

  it("accepts not-available submit lines", () => {
    const parsed = submitAvailabilitySchema.parse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          notAvailable: true,
          expectedVersion: 2,
        },
      ],
    });
    expect(parsed.lines[0]?.notAvailable).toBe(true);
    expect(parsed.lines[0]?.expectedVersion).toBe(2);
  });

  it("accepts partial responses with one unanswered and one positive line", () => {
    const parsed = submitAvailabilitySchema.parse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_blank",
          quantityDeclared: "",
          notAvailable: false,
        },
        {
          requestItemId: "ri_pos",
          quantityDeclared: "5",
          availableDate: "2026-11-25",
          notAvailable: false,
          expectedVersion: 1,
        },
      ],
    });
    expect(parsed.lines[0]?.quantityDeclared).toBeNull();
    expect(parsed.lines[1]?.quantityDeclared).toBe(5);
    expect(parsed.lines[1]?.availableDate).toBe("2026-11-25");
  });

  it("accepts positive quantity with delivery date", () => {
    const parsed = submitAvailabilitySchema.parse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          quantityDeclared: 12.5,
          availableDate: "2026-12-01",
          notAvailable: false,
        },
      ],
    });
    expect(parsed.lines[0]?.quantityDeclared).toBe(12.5);
  });

  it("maps zod issues to per-line field errors", () => {
    const result = submitAvailabilitySchema.safeParse({
      supplierRequestId: "sr_1",
      lines: [
        {
          requestItemId: "ri_1",
          quantityDeclared: "-1",
          notAvailable: false,
          expectedVersion: "",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = availabilityFieldErrorsFromZod(result.error, [
        { requestItemId: "ri_1" },
      ]);
      expect(fieldErrors["ri_1:quantity"]).toBeTruthy();
    }
  });
});
