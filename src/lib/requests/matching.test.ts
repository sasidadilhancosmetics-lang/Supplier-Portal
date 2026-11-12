import { describe, expect, it } from "vitest";

import { filterMatchingSuppliers, supplierMatchesBrand } from "./matching";

describe("supplier brand matching", () => {
  const brandId = "brand_a";

  it("matches ACTIVE all-brands suppliers", () => {
    expect(
      supplierMatchesBrand(
        {
          id: "s1",
          status: "ACTIVE",
          supportsAllBrands: true,
          brandIds: [],
        },
        brandId,
      ),
    ).toBe(true);
  });

  it("matches ACTIVE brand members", () => {
    expect(
      supplierMatchesBrand(
        {
          id: "s1",
          status: "ACTIVE",
          supportsAllBrands: false,
          brandIds: ["brand_a", "brand_b"],
        },
        brandId,
      ),
    ).toBe(true);
  });

  it("rejects non-members and inactive suppliers", () => {
    expect(
      supplierMatchesBrand(
        {
          id: "s1",
          status: "ACTIVE",
          supportsAllBrands: false,
          brandIds: ["brand_b"],
        },
        brandId,
      ),
    ).toBe(false);
    expect(
      supplierMatchesBrand(
        {
          id: "s1",
          status: "PENDING_REVIEW",
          supportsAllBrands: true,
          brandIds: [],
        },
        brandId,
      ),
    ).toBe(false);
  });

  it("filters to matching suppliers only", () => {
    const result = filterMatchingSuppliers(
      [
        {
          id: "all",
          status: "ACTIVE",
          supportsAllBrands: true,
          brandIds: [],
        },
        {
          id: "member",
          status: "ACTIVE",
          supportsAllBrands: false,
          brandIds: [brandId],
        },
        {
          id: "other",
          status: "ACTIVE",
          supportsAllBrands: false,
          brandIds: ["x"],
        },
        {
          id: "inactive",
          status: "INACTIVE",
          supportsAllBrands: true,
          brandIds: [],
        },
      ],
      brandId,
    );
    expect(result.map((s) => s.id)).toEqual(["all", "member"]);
  });
});
