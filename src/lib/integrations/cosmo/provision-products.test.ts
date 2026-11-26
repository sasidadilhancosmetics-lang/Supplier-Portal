import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/id", () => ({ createId: vi.fn(() => "generated") }));

import { provisionOsfProducts } from "./provision-products";
import type { CosmoOsfItem } from "./schema";

function item(sku: string, brand = "Brand A", vendor = "vendor-a", qty = 2): CosmoOsfItem {
  return {
    lineKey: sku,
    sku,
    description: `Title ${sku}`,
    barcode: undefined,
    brand: { name: brand, cosmoVendorId: vendor },
    quantity: { totalOrderQty: qty },
  };
}

function client() {
  return {
    brand: { findMany: vi.fn(), create: vi.fn() },
    product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

describe("OSF-owned product references", () => {
  const tx = client();
  beforeEach(() => {
    vi.resetAllMocks();
    tx.brand.findMany.mockResolvedValue([]);
    tx.brand.create.mockImplementation(async ({ data }) => ({ id: data.id, name: data.name }));
    tx.product.findMany.mockResolvedValue([]);
    tx.product.create.mockImplementation(async ({ data }) => ({ ...data }));
  });

  it("creates one brand and product for a new exact SKU and reuses it across OSF lines", async () => {
    const ambiguous = await provisionOsfProducts(tx as never, "company-a", [item("SKU-1"), item("SKU-1")]);
    expect(ambiguous.size).toBe(0);
    expect(tx.brand.create).toHaveBeenCalledTimes(1);
    expect(tx.brand.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { id: "generated", companyId: "company-a", name: "Brand A" },
    }));
    expect(tx.product.create).toHaveBeenCalledTimes(1);
    expect(tx.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: "company-a", sku: "SKU-1", name: "Title SKU-1" }),
    }));
  });

  it("updates the OSF title on a unique active reference without replacing its identity", async () => {
    tx.brand.findMany.mockResolvedValue([{ id: "brand-a", name: "Brand A" }]);
    tx.product.findMany.mockResolvedValue([{ id: "product-a", brandId: "brand-a", sku: "SKU-1", name: "Old", isActive: true }]);
    await provisionOsfProducts(tx as never, "company-a", [item("SKU-1")]);
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "product-a" }, data: { name: "Title SKU-1" } });
    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it("leaves inactive and duplicate legacy references for review", async () => {
    tx.brand.findMany.mockResolvedValue([{ id: "brand-a", name: "Brand A" }]);
    tx.product.findMany.mockResolvedValue([
      { id: "inactive", brandId: "brand-a", sku: "SKU-1", name: "Old", isActive: false },
    ]);
    await provisionOsfProducts(tx as never, "company-a", [item("SKU-1")]);
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();

    tx.product.findMany.mockResolvedValue([
      { id: "first", brandId: "brand-a", sku: "SKU-1", name: "First", isActive: true },
      { id: "second", brandId: "brand-a", sku: "SKU-1", name: "Second", isActive: true },
    ]);
    await provisionOsfProducts(tx as never, "company-a", [item("SKU-1")]);
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("does not merge two source vendors under one brand name or create zero-quantity products", async () => {
    const ambiguous = await provisionOsfProducts(tx as never, "company-a", [
      item("SKU-1", "Brand A", "vendor-a"),
      item("SKU-2", "Brand A", "vendor-b"),
      item("ZERO", "Brand B", "vendor-c", 0),
    ]);
    expect([...ambiguous]).toEqual(["Brand A"]);
    expect(tx.brand.create).not.toHaveBeenCalled();
    expect(tx.product.create).not.toHaveBeenCalled();
  });
});
