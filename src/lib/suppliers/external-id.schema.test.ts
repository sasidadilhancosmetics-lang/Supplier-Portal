import { describe, expect, it } from "vitest";

import {
  mapUnresolvedCosmoSupplierSchema,
  updateSupplierExternalIdSchema,
} from "./schema";

describe("Cosmo externalId schemas", () => {
  it("trims and clears blank externalId", () => {
    const set = updateSupplierExternalIdSchema.parse({
      supplierId: "sup_1",
      externalId: "  cosmo_abc  ",
      expectedExternalId: null,
    });
    expect(set.externalId).toBe("cosmo_abc");

    const clear = updateSupplierExternalIdSchema.parse({
      supplierId: "sup_1",
      externalId: "   ",
      expectedExternalId: "cosmo_abc",
      confirmChange: true,
    });
    expect(clear.externalId).toBeNull();
  });

  it("normalizes empty expectedPortalExternalId to null", () => {
    const parsed = mapUnresolvedCosmoSupplierSchema.parse({
      importId: "imp_1",
      cosmoSupplierId: "cosmo_1",
      portalSupplierId: "sup_1",
      expectedPortalExternalId: "",
    });
    expect(parsed.expectedPortalExternalId).toBeNull();
    expect(parsed.cosmoSupplierId).toBe("cosmo_1");
  });
});
