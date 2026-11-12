import { describe, expect, it } from "vitest";

import {
  addDraftRequirementItemSchema,
  confirmRequirementSchema,
  createDraftRequirementSchema,
  requirementListQuerySchema,
} from "./schema";

describe("requirement schemas", () => {
  it("requires positive quantities", () => {
    expect(
      addDraftRequirementItemSchema.safeParse({
        requirementId: "req_1",
        productId: "p_1",
        quantityPlanned: 0,
      }).success,
    ).toBe(false);
    expect(
      addDraftRequirementItemSchema.safeParse({
        requirementId: "req_1",
        productId: "p_1",
        quantityPlanned: -1,
      }).success,
    ).toBe(false);
    expect(
      addDraftRequirementItemSchema.parse({
        requirementId: "req_1",
        productId: "p_1",
        quantityPlanned: "2.5",
      }).quantityPlanned,
    ).toBe(2.5);
  });

  it("parses draft create with empty items", () => {
    const parsed = createDraftRequirementSchema.parse({
      brandId: "brand_1",
      title: "Test",
    });
    expect(parsed.items).toEqual([]);
  });

  it("treats empty status filter as undefined", () => {
    expect(requirementListQuerySchema.parse({ status: "" }).status).toBeUndefined();
  });

  it("requires requirementId to confirm", () => {
    expect(confirmRequirementSchema.safeParse({}).success).toBe(false);
  });
});
