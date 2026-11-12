import { describe, expect, it } from "vitest";

import { createSupplierSchema, supplierStatusChangeSchema } from "./schema";

describe("createSupplierSchema", () => {
  it("requires a company name", () => {
    const result = createSupplierSchema.safeParse({
      name: " ",
      supportsAllBrands: false,
      brandIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid payload", () => {
    const result = createSupplierSchema.safeParse({
      name: "Northwind Supplies",
      supportsAllBrands: true,
      brandIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createSupplierSchema.safeParse({
      name: "Northwind",
      contactEmail: "not-an-email",
      supportsAllBrands: false,
      brandIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("supplierStatusChangeSchema", () => {
  it("accepts activate and deactivate targets", () => {
    expect(
      supplierStatusChangeSchema.safeParse({
        supplierId: "sup_1",
        status: "ACTIVE",
      }).success,
    ).toBe(true);
    expect(
      supplierStatusChangeSchema.safeParse({
        supplierId: "sup_1",
        status: "INACTIVE",
      }).success,
    ).toBe(true);
  });
});
