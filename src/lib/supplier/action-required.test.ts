import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireSupplier, prisma, loadSubmittedDeliveryHolds } = vi.hoisted(
  () => ({
    requireSupplier: vi.fn(),
    prisma: {
      priceAgreement: { findMany: vi.fn() },
      supplierRequest: { findMany: vi.fn() },
      purchaseOrder: { findMany: vi.fn() },
      delivery: { findMany: vi.fn() },
    },
    loadSubmittedDeliveryHolds: vi.fn(),
  }),
);

vi.mock("@/lib/auth/guards", () => ({ requireSupplier }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/dates", () => ({
  formatDateTime: (d: Date | null) => (d ? d.toISOString() : "—"),
  formatCalendarDate: (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—"),
}));
vi.mock("@/lib/deliveries/holds", () => ({ loadSubmittedDeliveryHolds }));

import { loadSupplierActionRequired } from "./action-required";

describe("loadSupplierActionRequired", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupplier.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      supplierId: "sup_1",
      role: "SUPPLIER",
    });
    loadSubmittedDeliveryHolds.mockResolvedValue(new Map());
    prisma.purchaseOrder.findMany.mockResolvedValue([]);
    prisma.delivery.findMany.mockResolvedValue([]);
  });

  it("returns pending counters with Accept/Revise href for session supplier only", async () => {
    prisma.priceAgreement.findMany.mockResolvedValue([
      {
        availabilityOfferId: "offer_1",
        version: 2,
        currencyCode: "LKR",
        currentQuote: {
          unitPrice: { toString: () => "90" },
          currencyCode: "LKR",
          createdAt: new Date("2026-11-14T10:00:00.000Z"),
          supersedesQuote: {
            unitPrice: { toString: () => "100" },
            kind: "SUPPLIER_ORIGINAL",
          },
        },
        availabilityOffer: {
          id: "offer_1",
          requestItem: {
            supplierRequestId: "sr_1",
            product: { name: "Serum", sku: "SKU-1" },
          },
        },
      },
    ]);
    prisma.supplierRequest.findMany.mockResolvedValue([
      {
        id: "sr_open",
        status: "NEW",
        responseDeadline: new Date("2026-11-20T00:00:00.000Z"),
        brand: { name: "Brand A" },
        _count: { items: 3 },
      },
    ]);

    const result = await loadSupplierActionRequired();

    expect(prisma.priceAgreement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: "co_1",
          supplierId: "sup_1",
          status: "COUNTER_PENDING",
          currentQuote: { kind: "COMPANY_COUNTER" },
        },
      }),
    );
    expect(result.pendingCounters).toHaveLength(1);
    expect(result.pendingCounters[0]).toMatchObject({
      productName: "Serum",
      companyCounterPrice: "90",
      originalSupplierPrice: "100",
      agreementStatus: "COUNTER_PENDING",
      href: "/supplier/requests/sr_1?focus=counter&offer=offer_1",
    });
    expect(result.pendingAvailability).toHaveLength(1);
    expect(result.counts.actionRequired).toBe(2);
  });

  it("excludes resolved counters (empty COUNTER_PENDING set)", async () => {
    prisma.priceAgreement.findMany.mockResolvedValue([]);
    prisma.supplierRequest.findMany.mockResolvedValue([]);

    const result = await loadSupplierActionRequired();
    expect(result.pendingCounters).toEqual([]);
    expect(result.counts.pendingCounters).toBe(0);
  });

  it("includes POs awaiting confirm and approaching schedules", async () => {
    prisma.priceAgreement.findMany.mockResolvedValue([]);
    prisma.supplierRequest.findMany.mockResolvedValue([]);
    prisma.purchaseOrder.findMany
      .mockResolvedValueOnce([
        {
          id: "po_sent",
          orderNumber: "PO-1",
          createdAt: new Date("2026-11-10T00:00:00.000Z"),
          _count: { items: 2 },
          items: [
            { originalExpectedDeliveryAt: new Date("2026-11-20T00:00:00.000Z") },
          ],
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.delivery.findMany.mockResolvedValue([
      {
        id: "del_1",
        plannedDeliveryAt: new Date("2026-11-18T00:00:00.000Z"),
        purchaseOrder: { id: "po_c", orderNumber: "PO-C" },
      },
    ]);

    const result = await loadSupplierActionRequired();
    expect(result.pendingOrdersToConfirm).toHaveLength(1);
    expect(result.pendingOrdersToConfirm[0].href).toBe("/supplier/orders/po_sent");
    expect(result.approachingSchedules).toHaveLength(1);
    expect(result.approachingSchedules[0].href).toBe(
      "/supplier/orders/po_c/deliver",
    );
    expect(result.counts.actionRequired).toBe(2);
  });
});
