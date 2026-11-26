import { describe, expect, it } from "vitest";

import { deriveImportStatus, mapInboundLines } from "./mapping";
import type { CosmoOsfItem } from "./schema";

function item(
  partial: Partial<CosmoOsfItem> & Pick<CosmoOsfItem, "lineKey" | "sku">,
): CosmoOsfItem {
  return {
    description: partial.description ?? partial.sku,
    barcode: partial.barcode,
    brand: partial.brand ?? { cosmoVendorId: "vnd", name: "Brand A" },
    quantity: partial.quantity ?? { totalOrderQty: 5 },
    priorities: partial.priorities,
    snapshot: partial.snapshot,
    hints: partial.hints,
    lineKey: partial.lineKey,
    sku: partial.sku,
  };
}

describe("mapInboundLines", () => {
  const brandsByName = new Map([
    ["Brand A", { brandId: "br_a", brandName: "Brand A" }],
  ]);

  it("matches unique SKU on the resolved brand", () => {
    const productsBySku = new Map([
      ["SKU-1", [{ id: "p1", brandId: "br_a", sku: "SKU-1" }]],
    ]);
    const [line] = mapInboundLines({
      items: [item({ lineKey: "SKU-1", sku: "SKU-1" })],
      brandsByName,
      productsBySku,
    });
    expect(line!.mappingStatus).toBe("MATCHED_SKU");
    expect(line!.productId).toBe("p1");
    expect(line!.brandId).toBe("br_a");
  });

  it("marks unknown brand without selecting a product", () => {
    const [line] = mapInboundLines({
      items: [
        item({
          lineKey: "X",
          sku: "X",
          brand: { cosmoVendorId: "v", name: "Missing" },
        }),
      ],
      brandsByName,
      productsBySku: new Map(),
    });
    expect(line!.mappingStatus).toBe("UNKNOWN_BRAND");
    expect(line!.productId).toBeNull();
    expect(line!.brandId).toBeNull();
  });

  it("marks ambiguous SKU when multiple products share the SKU on the brand", () => {
    const productsBySku = new Map([
      [
        "DUP",
        [
          { id: "p1", brandId: "br_a", sku: "DUP" },
          { id: "p2", brandId: "br_a", sku: "DUP" },
        ],
      ],
    ]);
    const [line] = mapInboundLines({
      items: [item({ lineKey: "DUP", sku: "DUP" })],
      brandsByName,
      productsBySku,
    });
    expect(line!.mappingStatus).toBe("AMBIGUOUS_SKU");
    expect(line!.productId).toBeNull();
  });

  it("preserves zero-quantity lines as REJECTED_ZERO_QTY", () => {
    const productsBySku = new Map([
      ["Z", [{ id: "p1", brandId: "br_a", sku: "Z" }]],
    ]);
    const [line] = mapInboundLines({
      items: [item({ lineKey: "Z", sku: "Z", quantity: { totalOrderQty: 0 } })],
      brandsByName,
      productsBySku,
    });
    expect(line!.mappingStatus).toBe("REJECTED_ZERO_QTY");
    expect(line!.productId).toBeNull();
    expect(line!.quantityProposed).toBe(0);
  });

  it("does not match a product on a different brand", () => {
    const productsBySku = new Map([
      ["SKU-1", [{ id: "p_other", brandId: "br_other", sku: "SKU-1" }]],
    ]);
    const [line] = mapInboundLines({
      items: [item({ lineKey: "SKU-1", sku: "SKU-1" })],
      brandsByName,
      productsBySku,
    });
    expect(line!.mappingStatus).toBe("UNKNOWN_SKU");
    expect(line!.brandId).toBe("br_a");
  });

  it("does not case-fold SKU or brand name matches", () => {
    const productsBySku = new Map([
      ["sku-1", [{ id: "p1", brandId: "br_a", sku: "sku-1" }]],
    ]);
    const [wrongCaseSku] = mapInboundLines({
      items: [item({ lineKey: "SKU-1", sku: "SKU-1" })],
      brandsByName,
      productsBySku,
    });
    expect(wrongCaseSku!.mappingStatus).toBe("UNKNOWN_SKU");
    expect(wrongCaseSku!.productId).toBeNull();
    expect(wrongCaseSku!.cosmoVendorId).toBe("vnd");

    const [wrongCaseBrand] = mapInboundLines({
      items: [
        item({
          lineKey: "X",
          sku: "sku-1",
          brand: { cosmoVendorId: "vnd_x", name: "brand a" },
        }),
      ],
      brandsByName,
      productsBySku,
    });
    expect(wrongCaseBrand!.mappingStatus).toBe("UNKNOWN_BRAND");
    expect(wrongCaseBrand!.cosmoVendorId).toBe("vnd_x");
    expect(wrongCaseBrand!.brandNameSnapshot).toBe("brand a");
  });

  it("preserves cosmoVendorId on every line including unresolved", () => {
    const [line] = mapInboundLines({
      items: [
        item({
          lineKey: "Z",
          sku: "Z",
          brand: { cosmoVendorId: "vendor-99", name: "Missing" },
          quantity: { totalOrderQty: 0 },
        }),
      ],
      brandsByName,
      productsBySku: new Map(),
    });
    expect(line!.cosmoVendorId).toBe("vendor-99");
    expect(line!.mappingStatus).toBe("REJECTED_ZERO_QTY");
  });

  it("derives READY_TO_CONFIRM only when every keepable line is matched", () => {
    const matched = mapInboundLines({
      items: [item({ lineKey: "A", sku: "A" })],
      brandsByName,
      productsBySku: new Map([
        ["A", [{ id: "p1", brandId: "br_a", sku: "A" }]],
      ]),
    });
    expect(deriveImportStatus(matched)).toBe("READY_TO_CONFIRM");

    const withUnknown = mapInboundLines({
      items: [
        item({ lineKey: "A", sku: "A" }),
        item({ lineKey: "B", sku: "B" }),
      ],
      brandsByName,
      productsBySku: new Map([
        ["A", [{ id: "p1", brandId: "br_a", sku: "A" }]],
      ]),
    });
    expect(deriveImportStatus(withUnknown)).toBe("NEEDS_REVIEW");
  });
});
