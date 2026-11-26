import { describe, expect, it } from "vitest";

import {
  productListQuerySchema,
  updateProductSchema,
} from "./schema";

describe("product schemas", () => {
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
