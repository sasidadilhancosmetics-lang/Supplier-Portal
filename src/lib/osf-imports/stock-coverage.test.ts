import { describe, expect, it } from "vitest";

import { parseCosmoOsfPushPayload, canonicalOsfPushPayload } from "@/lib/integrations/cosmo/schema";
import { coverageLabel, isBelowCoverage, parseCoverageThreshold, stockCoverage } from "./stock-coverage";
import { readStockSnapshot } from "./stock-snapshot";

const cutoff = parseCoverageThreshold("27.5")!;

describe("stock coverage", () => {
  it.each([
    ["27.49", "100", "27.49%", true],
    ["27.5", "100", "27.5%", false],
    ["27.51", "100", "27.51%", false],
    ["0", "0.005", "0%", true],
    ["2.749", "10.0", "27.49%", true],
    ["0.0275", "0.1", "27.5%", false],
    [null, "100", "Unknown", false],
    ["1", null, "Unknown", false],
    ["1", "0", "N/A (ROP is zero)", false],
  ])("compares stock %s to ROP %s", (stock, rop, label, below) => {
    const coverage = stockCoverage(stock, rop);
    expect(coverageLabel(coverage)).toBe(label);
    expect(isBelowCoverage(coverage, cutoff)).toBe(below);
  });

  it.each(["", "-1", "NaN", "100.01", "27.5%", "1e2", "27.5.1"])("rejects threshold %j", (threshold) => {
    expect(parseCoverageThreshold(threshold)).toBeNull();
  });

  it("compares fine decimal differences without display rounding", () => {
    const coverage = stockCoverage("27.49999999999999999999999999", "100");
    expect(isBelowCoverage(coverage, cutoff)).toBe(true);
    expect(coverageLabel(coverage)).toBe("≈27.4999%");
  });
});

const source = { system: "cosmo-os", cosmoCompanyId: "cosmo", sentAt: "2026-11-23T06:00:00Z" };
const line = {
  lineKey: "line",
  sku: "sku",
  description: "Synthetic",
  brand: { cosmoVendorId: "brand", name: "Brand" },
  quantity: { totalOrderQty: 42 },
};
const basePayload = {
  contractVersion: "cosmo-osf-push.v1",
  idempotencyKey: "stock-idempotency-test",
  source,
  selection: { mode: "SUPPLIER_ORDERS_SELECTION" },
};

describe("immutable OSF stock snapshots", () => {
  it("accepts decimal strings and includes the snapshot and ERP provenance in canonical hashing", () => {
    const snapshot = {
      totalStock: "2.74900000000000000001",
      totalRop: "10.00",
      columns: [{ columnKey: "primary", erpInstanceId: "erp-1", itemCode: "sku", warehouses: ["WH-1"] }],
    };
    const push = parseCosmoOsfPushPayload({ ...basePayload, source: { ...source, asOfDate: "2026-11-23" }, items: [{ ...line, snapshot }] });
    expect(canonicalOsfPushPayload(push)).toMatchObject({ items: [{ quantity: { totalOrderQty: 42 }, snapshot }] });
    const saved = readStockSnapshot(push);
    expect(saved.asOfDate).toBe("2026-11-23");
    expect(saved.forLine(0, line.lineKey, line.sku)).toEqual({ totalStock: snapshot.totalStock, totalRop: snapshot.totalRop });
    expect(saved.forLine(0, "different", line.sku)).toEqual({ totalStock: null, totalRop: null });
  });

  it("keeps legacy numbers compatible and leaves historical missing data unknown across imports", () => {
    const old = parseCosmoOsfPushPayload({ ...basePayload, items: [line] });
    const next = parseCosmoOsfPushPayload({ ...basePayload, items: [{ ...line, snapshot: { totalStock: 0, totalRop: 10.5 } }] });
    expect(canonicalOsfPushPayload(next)).toMatchObject({ items: [{ snapshot: { totalStock: 0, totalRop: 10.5 } }] });
    expect(readStockSnapshot(old).forLine(0, line.lineKey, line.sku)).toEqual({ totalStock: null, totalRop: null });
    expect(readStockSnapshot(next).forLine(0, line.lineKey, line.sku)).toEqual({ totalStock: "0", totalRop: "10.5" });
  });
});
