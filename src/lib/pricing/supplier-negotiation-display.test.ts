import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prisma } = vi.hoisted(() => ({
  prisma: {
    orderItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    priceQuote: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/dates", () => ({
  formatDateTime: (d: Date) => d.toISOString(),
  formatCalendarDate: (d: Date) => d.toISOString().slice(0, 10),
}));

import {
  buildCounterNegotiationDisplay,
  loadLastPurchaseForSupplierProduct,
  loadLastPurchasesForSupplierProducts,
  loadPreviousSupplierQuotedPrice,
} from "./supplier-negotiation-display";

describe("buildCounterNegotiationDisplay", () => {
  it("maps company counter and current supplier quote accurately", () => {
    const display = buildCounterNegotiationDisplay({
      currentQuote: {
        id: "q_counter",
        unitPrice: { toString: () => "90" },
        currencyCode: "LKR",
        kind: "COMPANY_COUNTER",
        createdAt: new Date("2026-11-15T10:00:00.000Z"),
        supersedesQuote: {
          id: "q_supplier",
          unitPrice: { toString: () => "100" },
          currencyCode: "LKR",
          kind: "SUPPLIER_ORIGINAL",
          createdAt: new Date("2026-11-14T10:00:00.000Z"),
        },
      },
      lastPurchase: {
        unitPrice: "85",
        currencyCode: "LKR",
        purchasedAt: new Date("2026-10-01T00:00:00.000Z"),
        purchasedAtLabel: "2026-10-01",
        orderNumber: "PO-1",
      },
      previousQuotedPrice: {
        unitPrice: "95",
        currencyCode: "LKR",
        kind: "SUPPLIER_ORIGINAL",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        createdAtLabel: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(display.companyCounterPrice).toBe("90");
    expect(display.currentSupplierQuote?.unitPrice).toBe("100");
    expect(display.currentSupplierQuote?.kind).toBe("SUPPLIER_ORIGINAL");
    expect(display.lastPurchase?.unitPrice).toBe("85");
    expect(display.previousQuotedPrice?.unitPrice).toBe("95");
    expect(display.companyCounterPrice).not.toBe(
      display.currentSupplierQuote?.unitPrice,
    );
  });

  it("handles missing purchase and missing prior quote", () => {
    const display = buildCounterNegotiationDisplay({
      currentQuote: {
        id: "q_counter",
        unitPrice: { toString: () => "88" },
        currencyCode: null,
        kind: "COMPANY_COUNTER",
        createdAt: new Date("2026-11-15T10:00:00.000Z"),
        supersedesQuote: null,
      },
      lastPurchase: null,
      previousQuotedPrice: null,
    });

    expect(display.currencyCode).toBe("LKR");
    expect(display.companyCounterPrice).toBe("88");
    expect(display.currentSupplierQuote).toBeNull();
    expect(display.lastPurchase).toBeNull();
    expect(display.previousQuotedPrice).toBeNull();
  });
});

describe("loadLastPurchaseForSupplierProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes purchase lookup to company + supplier + product", async () => {
    prisma.orderItem.findFirst.mockResolvedValue({
      unitPrice: { toString: () => "70" },
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      purchaseOrder: {
        orderNumber: "PO-9",
        confirmedAt: new Date("2026-08-02T00:00:00.000Z"),
        currencyCode: "LKR",
      },
    });

    const result = await loadLastPurchaseForSupplierProduct({
      companyId: "co_1",
      supplierId: "sup_1",
      productId: "prod_1",
    });

    expect(prisma.orderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "co_1",
          supplierId: "sup_1",
          productId: "prod_1",
          purchaseOrder: expect.objectContaining({
            companyId: "co_1",
            supplierId: "sup_1",
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      unitPrice: "70",
      orderNumber: "PO-9",
      purchasedAtLabel: "2026-08-02",
    });
  });

  it("returns null when no purchase history exists", async () => {
    prisma.orderItem.findFirst.mockResolvedValue(null);
    const result = await loadLastPurchaseForSupplierProduct({
      companyId: "co_1",
      supplierId: "sup_1",
      productId: "prod_1",
    });
    expect(result).toBeNull();
  });
});

describe("supplier isolation on quote/purchase loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never queries another supplier id for purchases", async () => {
    prisma.orderItem.findMany.mockResolvedValue([]);
    await loadLastPurchasesForSupplierProducts({
      companyId: "co_1",
      supplierId: "sup_mine",
      productIds: ["prod_1"],
    });
    const where = prisma.orderItem.findMany.mock.calls[0]?.[0]?.where;
    expect(where.supplierId).toBe("sup_mine");
    expect(where.purchaseOrder.supplierId).toBe("sup_mine");
    expect(where.companyId).toBe("co_1");
  });

  it("scopes previous quoted price to session supplier only", async () => {
    prisma.priceQuote.findFirst.mockResolvedValue(null);
    await loadPreviousSupplierQuotedPrice({
      companyId: "co_1",
      supplierId: "sup_mine",
      productId: "prod_1",
      excludeQuoteIds: ["q_a", "q_b"],
      excludeOfferId: "offer_1",
    });
    expect(prisma.priceQuote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "co_1",
          supplierId: "sup_mine",
          productId: "prod_1",
          kind: { in: ["SUPPLIER_ORIGINAL", "SUPPLIER_REVISED"] },
          id: { notIn: ["q_a", "q_b"] },
        }),
      }),
    );
  });
});
