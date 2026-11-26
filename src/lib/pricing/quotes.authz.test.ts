import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireStaffPermission,
  requireSupplierOwnership,
  writeAuditLog,
  notifySupplierUsersOfPriceCounter,
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
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
    },
  };
  return {
    requireStaffPermission: vi.fn(),
    requireSupplierOwnership: vi.fn(),
    writeAuditLog: vi.fn(),
    notifySupplierUsersOfPriceCounter: vi.fn(),
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
  requireStaffPermission,
  requireSupplierOwnership,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog,
}));

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/id", () => ({
  createId: () => "id_new",
}));

vi.mock("@/lib/notifications", () => ({
  notifySupplierUsersOfPriceCounter,
  notifyCompanyUsersOfPriceAcceptance: vi.fn(),
  notifyCompanyUsersOfPriceRevision: vi.fn(),
}));

import { PricingDomainError } from "./errors";
import {
  requireAgreedPriceForAllocate,
  staffCounterOffer,
  staffRecordExternalNegotiation,
} from "./quotes";

function offerFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer_1",
    supplierId: "sup_1",
    status: "SUBMITTED",
    quantityDeclared: { toString: () => "10" },
    availableDate: new Date("2026-12-01"),
    unitPrice: { equals: () => false, toString: () => "100" },
    currencyCode: "LKR",
    version: 1,
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
      status: "QUOTED",
      currentQuoteId: "pq_1",
      unitPrice: { equals: () => true, toString: () => "100" },
      currencyCode: "LKR",
      channel: "PORTAL",
      version: 1,
      currentQuote: {
        id: "pq_1",
        unitPrice: { toString: () => "100" },
        status: "QUOTED",
        kind: "SUPPLIER_ORIGINAL",
        availabilityOfferId: "offer_1",
      },
    },
    ...overrides,
  };
}

describe("pricing authz and agreement gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStaffPermission.mockResolvedValue({
      id: "u_staff",
      companyId: "co_1",
      role: "STAFF",
    });
    writeAuditLog.mockResolvedValue(undefined);
    notifySupplierUsersOfPriceCounter.mockResolvedValue({ notified: 1 });
    tx.priceQuote.create.mockResolvedValue({});
    tx.priceQuote.update.mockResolvedValue({});
    tx.priceAgreement.updateMany.mockResolvedValue({ count: 1 });
    tx.availabilityOffer.update.mockResolvedValue({});
    tx.product.findFirst.mockResolvedValue({ name: "Serum" });
  });

  it("rejects staff counter when offer is in another company", async () => {
    tx.availabilityOffer.findFirst.mockResolvedValue(
      offerFixture({
        requestItem: {
          id: "ri_1",
          productId: "prod_1",
          supplierRequestId: "sr_1",
          supplierRequest: {
            id: "sr_1",
            companyId: "co_other",
            supplierId: "sup_1",
          },
        },
      }),
    );

    await expect(
      staffCounterOffer({
        availabilityOfferId: "offer_1",
        unitPrice: 90,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates company counter and bumps agreement version", async () => {
    tx.availabilityOffer.findFirst.mockResolvedValue(offerFixture());

    const result = await staffCounterOffer({
      availabilityOfferId: "offer_1",
      unitPrice: 90,
      expectedVersion: 1,
    });

    expect(result.quoteId).toBe("id_new");
    expect(tx.priceQuote.create).toHaveBeenCalled();
    expect(tx.priceAgreement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pa_1", version: 1 },
        data: expect.objectContaining({ status: "COUNTER_PENDING" }),
      }),
    );
    expect(notifySupplierUsersOfPriceCounter).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co_1",
        supplierId: "sup_1",
        availabilityOfferId: "offer_1",
        supplierRequestId: "sr_1",
        productName: "Serum",
        counterPrice: "90",
      }),
    );
  });

  it("records phone negotiation as unconfirmed, not agreed", async () => {
    tx.availabilityOffer.findFirst.mockResolvedValue(offerFixture());

    await staffRecordExternalNegotiation({
      availabilityOfferId: "offer_1",
      unitPrice: 88,
      channel: "PHONE",
      negotiationOccurredAt: "2026-11-13T09:00:00.000Z",
      expectedVersion: 1,
    });

    expect(tx.priceQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: "PHONE",
          kind: "STAFF_RECORDED_EXTERNAL",
          status: "STAFF_RECORDED_UNCONFIRMED",
        }),
      }),
    );
  });

  it("requireAgreedPriceForAllocate rejects QUOTED", async () => {
    tx.priceAgreement.findFirst.mockResolvedValue({
      status: "QUOTED",
      unitPrice: { equals: () => true },
      currentQuoteId: "pq_1",
      currentQuote: {
        availabilityOfferId: "offer_1",
        unitPrice: {},
      },
    });

    await expect(
      requireAgreedPriceForAllocate(tx as never, {
        availabilityOfferId: "offer_1",
        companyId: "co_1",
        supplierId: "sup_1",
      }),
    ).rejects.toBeInstanceOf(PricingDomainError);
  });

  it("requireAgreedPriceForAllocate accepts SUPPLIER_CONFIRMED", async () => {
    const unitPrice = { equals: () => true };
    tx.priceAgreement.findFirst.mockResolvedValue({
      status: "SUPPLIER_CONFIRMED",
      unitPrice,
      currentQuoteId: "pq_ok",
      currencyCode: "LKR",
      currentQuote: {
        availabilityOfferId: "offer_1",
        unitPrice,
      },
    });

    const agreed = await requireAgreedPriceForAllocate(tx as never, {
      availabilityOfferId: "offer_1",
      companyId: "co_1",
      supplierId: "sup_1",
    });
    expect(agreed.priceQuoteId).toBe("pq_ok");
    expect(agreed.priceAgreementStatusAtOrder).toBe("SUPPLIER_CONFIRMED");
  });

  it("requireAgreedPriceForAllocate rejects offer/quote mismatch", async () => {
    const unitPrice = { equals: () => true };
    tx.priceAgreement.findFirst.mockResolvedValue({
      status: "SUPPLIER_CONFIRMED",
      unitPrice,
      currentQuoteId: "pq_ok",
      currentQuote: {
        availabilityOfferId: "offer_OTHER",
        unitPrice,
      },
    });

    await expect(
      requireAgreedPriceForAllocate(tx as never, {
        availabilityOfferId: "offer_1",
        companyId: "co_1",
        supplierId: "sup_1",
      }),
    ).rejects.toMatchObject({ code: "OFFER_QUOTE_MISMATCH" });
  });
});
