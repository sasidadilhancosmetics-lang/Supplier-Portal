import { describe, expect, it } from "vitest";

import type { MappedLine } from "./mapping";
import {
  deriveSuggestionMapping,
  isSuggestionLineActionable,
  mapRequestSuggestions,
} from "./suggestion-mapping";

function matchedLine(
  overrides: Partial<MappedLine> & Pick<MappedLine, "lineKey">,
): MappedLine {
  return {
    sourceIndex: 0,
    sku: overrides.lineKey,
    descriptionSnapshot: overrides.lineKey,
    cosmoVendorId: "vnd",
    brandNameSnapshot: "Brand A",
    erp1Priority: null,
    erp2Priority: null,
    quantityProposed: 10,
    quantityPlanned: 10,
    mappingStatus: "MATCHED_SKU",
    brandId: "br_a",
    productId: "p1",
    ...overrides,
  };
}

describe("mapRequestSuggestions", () => {
  const suppliersByExternalId = new Map([
    [
      "cosmo_sup_active",
      {
        id: "sup_active",
        status: "ACTIVE",
        supportsAllBrands: true,
        brandIds: [] as string[],
        externalId: "cosmo_sup_active",
      },
    ],
    [
      "cosmo_sup_brand",
      {
        id: "sup_brand",
        status: "ACTIVE",
        supportsAllBrands: false,
        brandIds: ["br_a"],
        externalId: "cosmo_sup_brand",
      },
    ],
    [
      "cosmo_sup_wrong_brand",
      {
        id: "sup_wrong",
        status: "ACTIVE",
        supportsAllBrands: false,
        brandIds: ["br_other"],
        externalId: "cosmo_sup_wrong_brand",
      },
    ],
    [
      "cosmo_sup_inactive",
      {
        id: "sup_inactive",
        status: "INACTIVE",
        supportsAllBrands: true,
        brandIds: [] as string[],
        externalId: "cosmo_sup_inactive",
      },
    ],
  ]);

  it("maps matched, unresolved, and ineligible suppliers", () => {
    const mapped = mapRequestSuggestions({
      suggestions: [
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_sup_active",
          cosmoSupplierName: "Active Co",
          suggestedRequestQty: 4,
        },
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_unknown",
          cosmoSupplierName: "Unknown Co",
          suggestedRequestQty: 3,
        },
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_sup_wrong_brand",
          cosmoSupplierName: "Wrong Brand Co",
          suggestedRequestQty: 2,
        },
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_sup_inactive",
          cosmoSupplierName: "Inactive Co",
          suggestedRequestQty: 1,
        },
      ],
      mappedLines: [matchedLine({ lineKey: "SKU-1" })],
      suppliersByExternalId,
    });

    expect(mapped.map((m) => m.mappingStatus)).toEqual([
      "MATCHED_SUPPLIER",
      "UNRESOLVED_SUPPLIER",
      "INELIGIBLE_BRAND",
      "INELIGIBLE_BRAND",
    ]);
    expect(mapped[0]!.supplierId).toBe("sup_active");
    expect(mapped[1]!.supplierId).toBeNull();
    expect(mapped[2]!.supplierId).toBe("sup_wrong");
    expect(mapped[3]!.supplierId).toBe("sup_inactive");
  });

  it("marks over-line warnings without changing quantities", () => {
    const mapped = mapRequestSuggestions({
      suggestions: [
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_sup_active",
          cosmoSupplierName: "A",
          suggestedRequestQty: 6,
        },
        {
          lineKey: "SKU-1",
          cosmoSupplierId: "cosmo_sup_brand",
          cosmoSupplierName: "B",
          suggestedRequestQty: 5,
        },
      ],
      mappedLines: [matchedLine({ lineKey: "SKU-1", quantityProposed: 10 })],
      suppliersByExternalId,
    });

    expect(mapped.every((m) => m.warningFlags?.overLineQty === true)).toBe(
      true,
    );
    expect(mapped[0]!.suggestedRequestQty).toBe(6);
    expect(mapped[1]!.suggestedRequestQty).toBe(5);
  });

  it("preserves LINE_NOT_ACTIONABLE for zero and unresolved lines", () => {
    const zero = matchedLine({
      lineKey: "SKU-Z",
      quantityProposed: 0,
      quantityPlanned: 0,
      mappingStatus: "REJECTED_ZERO_QTY",
      productId: null,
    });
    const unknown = matchedLine({
      lineKey: "SKU-U",
      mappingStatus: "UNKNOWN_SKU",
      productId: null,
    });

    const mapped = mapRequestSuggestions({
      suggestions: [
        {
          lineKey: "SKU-Z",
          cosmoSupplierId: "cosmo_sup_active",
          cosmoSupplierName: "A",
          suggestedRequestQty: 2,
        },
        {
          lineKey: "SKU-U",
          cosmoSupplierId: "cosmo_unknown",
          cosmoSupplierName: "U",
          suggestedRequestQty: 1,
        },
      ],
      mappedLines: [zero, unknown],
      suppliersByExternalId,
    });

    expect(mapped[0]!.mappingStatus).toBe("LINE_NOT_ACTIONABLE");
    expect(mapped[0]!.supplierId).toBe("sup_active");
    expect(mapped[1]!.mappingStatus).toBe("LINE_NOT_ACTIONABLE");
    expect(mapped[1]!.supplierId).toBeNull();
  });

  it("isSuggestionLineActionable requires MATCHED_SKU and positive planned", () => {
    expect(
      isSuggestionLineActionable(matchedLine({ lineKey: "A" })),
    ).toBe(true);
    expect(
      isSuggestionLineActionable(
        matchedLine({
          lineKey: "B",
          mappingStatus: "UNKNOWN_SKU",
          productId: null,
        }),
      ),
    ).toBe(false);
    expect(
      isSuggestionLineActionable(
        matchedLine({
          lineKey: "C",
          quantityPlanned: 0,
          mappingStatus: "REJECTED_ZERO_QTY",
          productId: null,
        }),
      ),
    ).toBe(false);
  });

  it("deriveSuggestionMapping rematch helpers match F2A statuses", () => {
    const active = {
      id: "sup_a",
      status: "ACTIVE",
      supportsAllBrands: true,
      brandIds: [] as string[],
      externalId: "c1",
    };
    expect(
      deriveSuggestionMapping({
        line: matchedLine({ lineKey: "A" }),
        supplier: active,
      }),
    ).toEqual({ mappingStatus: "MATCHED_SUPPLIER", supplierId: "sup_a" });

    expect(
      deriveSuggestionMapping({
        line: matchedLine({ lineKey: "A" }),
        supplier: null,
      }),
    ).toEqual({ mappingStatus: "UNRESOLVED_SUPPLIER", supplierId: null });

    expect(
      deriveSuggestionMapping({
        line: matchedLine({
          lineKey: "Z",
          mappingStatus: "EXCLUDED",
          quantityPlanned: 5,
        }),
        supplier: active,
      }),
    ).toEqual({ mappingStatus: "LINE_NOT_ACTIONABLE", supplierId: "sup_a" });
  });
});
