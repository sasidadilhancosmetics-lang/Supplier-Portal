import { describe, expect, it } from "vitest";

import {
  createProvisionalProductSchema,
  productListQuerySchema,
  updateProductSchema,
} from "./schema";

describe("product schemas", () => {
  it("creates provisional product input without ERP fields", () => {
    const parsed = createProvisionalProductSchema.parse({
      name: "Serum",
      brandId: "brand_1",
      sku: "SKU-1",
      priorityStatus: "HIGH",
    });
    expect(parsed.name).toBe("Serum");
    expect(parsed.priorityStatus).toBe("HIGH");
  });

  it("rejects empty product name", () => {
    const result = createProvisionalProductSchema.safeParse({
      name: "  ",
      brandId: "brand_1",
    });
    expect(result.success).toBe(false);
  });

  it("treats empty masterStatus filter as undefined", () => {
    const parsed = productListQuerySchema.parse({ masterStatus: "" });
    expect(parsed.masterStatus).toBeUndefined();
  });

  it("requires productId on update", () => {
    const result = updateProductSchema.safeParse({
      name: "Serum",
      brandId: "brand_1",
      priorityStatus: "NORMAL",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
