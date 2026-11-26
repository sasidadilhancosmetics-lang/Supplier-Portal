import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireSupplierOwnership,
  writeAuditLog,
  notifyCompanyUsersOfPriceAcceptance,
  tx,
  prisma,
} = vi.hoisted(() => {
  const tx = {
    availabilityOffer: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    priceQuote: {
      create: vi.fn(),
      update: vi.fn(),
    },
    priceAgreement: {
      updateMany: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
    },
    supplier: {
      findFirst: vi.fn(),
    },
  };
  return {
    requireSupplierOwnership: vi.fn(),
    writeAuditLog: vi.fn(),
    notifyCompanyUsersOfPriceAcceptance: vi.fn(),
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      availabilityOffer: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
  requireSupplierOwnership,
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog }));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/id", () => ({
  createId: () => "id_accept",
}));

vi.mock("@/lib/notifications", () => ({
  notifySupplierUsersOfPriceCounter: vi.fn(),
  notifyCompanyUsersOfPriceAcceptance,
  notifyCompanyUsersOfPriceRevision: vi.fn(),
}));

import { PricingDomainError } from "./errors";
import { supplierAcceptCounter } from "./quotes";

function counterOfferFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer_1",
    supplierId: "sup_1",
    status: "SUBMITTED",
    quantityDeclared: { toString: () => "10" },
    availableDate: new Date("2026-12-01T00:00:00.000Z"),
    reservedAt: new Date("2026-11-10T00:00:00.000Z"),
    reserveExpiresAt: new Date("2026-11-17T00:00:00.000Z"),
    unitPrice: { toString: () => "90", equals: () => false },
    currencyCode: "LKR",
    version: 2,
    requestItem: {
      id: "ri_1",
      productId: "prod_1",
      supplierRequestId: "sr_1",
      supplierRequest: {
        id: "sr_1",
        companyId: "co_1",
        supplierId: "sup_1",
      },
    },
    priceAgreement: {
      id: "pa_1",
      status: "COUNTER_PENDING",
      currentQuoteId: "pq_counter",
      unitPrice: { toString: () => "90", equals: () => true },
      currencyCode: "LKR",
      channel: "PORTAL",
      version: 2,
      currentQuote: {
        id: "pq_counter",
        unitPrice: { toString: () => "90" },
        status: "COUNTER_PENDING",
        kind: "COMPANY_COUNTER",
        availabilityOfferId: "offer_1",
      },
    },
    ...overrides,
  };
}

describe("supplierAcceptCounter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupplierOwnership.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      role: "SUPPLIER",
      supplierId: "sup_1",
    });
    writeAuditLog.mockResolvedValue(undefined);
    notifyCompanyUsersOfPriceAcceptance.mockResolvedValue({ notified: 1 });
    prisma.availabilityOffer.findFirst.mockResolvedValue({
      supplierId: "sup_1",
    });
    tx.priceQuote.create.mockResolvedValue({});
    tx.priceQuote.update.mockResolvedValue({});
    tx.priceAgreement.updateMany.mockResolvedValue({ count: 1 });
    tx.availabilityOffer.update.mockResolvedValue({});
    tx.product.findFirst.mockResolvedValue({ name: "Serum" });
    tx.supplier.findFirst.mockResolvedValue({ name: "Acme Supply" });
  });

  it("accepts independently: confirms agreement, notifies once, leaves qty/date/reserve fields untouched in update", async () => {
    tx.availabilityOffer.findFirst.mockResolvedValue(counterOfferFixture());

    const result = await supplierAcceptCounter({
      availabilityOfferId: "offer_1",
      expectedVersion: 2,
    });

    expect(result).toMatchObject({
      quoteId: "id_accept",
      availabilityOfferId: "offer_1",
      supplierRequestId: "sr_1",
      unitPrice: "90",
      currencyCode: "LKR",
      alreadyConfirmed: false,
    });

    expect(tx.priceQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "SUPPLIER_ACCEPTANCE",
          status: "SUPPLIER_CONFIRMED",
          unitPrice: expect.anything(),
          supersedesQuoteId: "pq_counter",
        }),
      }),
    );
    expect(tx.priceAgreement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pa_1", version: 2 },
        data: expect.objectContaining({ status: "SUPPLIER_CONFIRMED" }),
      }),
    );
    expect(tx.availabilityOffer.update).toHaveBeenCalledWith({
      where: { id: "offer_1" },
      data: {
        unitPrice: expect.anything(),
        currencyCode: "LKR",
      },
    });
    const updateData = tx.availabilityOffer.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("quantityDeclared");
    expect(updateData).not.toHaveProperty("availableDate");
    expect(updateData).not.toHaveProperty("reservedAt");
    expect(updateData).not.toHaveProperty("reserveExpiresAt");

    expect(notifyCompanyUsersOfPriceAcceptance).toHaveBeenCalledTimes(1);
    expect(notifyCompanyUsersOfPriceAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co_1",
        availabilityOfferId: "offer_1",
        unitPrice: "90",
        productName: "Serum",
      }),
    );
  });

  it("is idempotent when already SUPPLIER_CONFIRMED — no duplicate quote or notify", async () => {
    tx.availabilityOffer.findFirst.mockResolvedValue(
      counterOfferFixture({
        priceAgreement: {
          id: "pa_1",
          status: "SUPPLIER_CONFIRMED",
          currentQuoteId: "pq_accept",
          unitPrice: { toString: () => "90" },
          currencyCode: "LKR",
          channel: "PORTAL",
          version: 3,
          currentQuote: {
            id: "pq_accept",
            unitPrice: { toString: () => "90" },
            status: "SUPPLIER_CONFIRMED",
            kind: "SUPPLIER_ACCEPTANCE",
            availabilityOfferId: "offer_1",
          },
        },
      }),
    );

    const result = await supplierAcceptCounter({
      availabilityOfferId: "offer_1",
      expectedVersion: 3,
    });

    expect(result.alreadyConfirmed).toBe(true);
    expect(result.quoteId).toBe("pq_accept");
    expect(tx.priceQuote.create).not.toHaveBeenCalled();
    expect(notifyCompanyUsersOfPriceAcceptance).not.toHaveBeenCalled();
  });

  it("rejects cross-supplier ownership", async () => {
    requireSupplierOwnership.mockRejectedValueOnce(
      new PricingDomainError("NOT_FOUND", "Offer not found."),
    );
    prisma.availabilityOffer.findFirst.mockResolvedValue({
      supplierId: "sup_other",
    });

    await expect(
      supplierAcceptCounter({
        availabilityOfferId: "offer_1",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
