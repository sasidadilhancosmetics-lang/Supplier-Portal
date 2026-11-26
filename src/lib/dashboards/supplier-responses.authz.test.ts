import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prisma, loadRequirementCoverage, loadCompanyPriceActionItems } =
  vi.hoisted(() => ({
    prisma: {
      supplierRequest: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      availabilityOffer: {
        findMany: vi.fn(),
      },
    },
    loadRequirementCoverage: vi.fn(),
    loadCompanyPriceActionItems: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/orders/coverage", () => ({ loadRequirementCoverage }));
vi.mock("./price-actions", () => ({ loadCompanyPriceActionItems }));

import { loadSupplierResponseDashboard } from "./supplier-responses";

describe("loadSupplierResponseDashboard company scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.supplierRequest.count.mockResolvedValue(0);
    prisma.supplierRequest.findMany.mockResolvedValue([]);
    prisma.availabilityOffer.findMany.mockResolvedValue([]);
    loadRequirementCoverage.mockResolvedValue(new Map());
    loadCompanyPriceActionItems.mockResolvedValue({
      confirmedForReview: [],
      revisedAwaitingDecision: [],
      counts: {
        confirmedForReview: 0,
        revisedAwaitingDecision: 0,
        readyForAllocation: 0,
      },
    });
  });

  it("scopes all queries to the provided companyId", async () => {
    await loadSupplierResponseDashboard("co_only");

    expect(prisma.supplierRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "co_only" }),
      }),
    );
    expect(prisma.availabilityOffer.findMany).toHaveBeenCalled();
    for (const call of prisma.availabilityOffer.findMany.mock.calls) {
      expect(call[0].where.requestItem.companyId).toBe("co_only");
    }
    expect(prisma.supplierRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "co_only" }),
        orderBy: { respondedAt: "desc" },
      }),
    );
  });

  it("orders recent responses by respondedAt descending", async () => {
    prisma.supplierRequest.findMany.mockResolvedValue([
      {
        id: "sr_new",
        status: "RESPONDED",
        respondedAt: new Date("2026-11-16T05:00:00.000Z"),
        supplier: { name: "Buddy" },
        brand: { name: "Brand A" },
        requirement: { title: "Req" },
      },
    ]);

    const result = await loadSupplierResponseDashboard("co_1");
    expect(result.recentResponses[0]?.supplierName).toBe("Buddy");
    expect(result.recentResponses[0]?.href).toBe("/staff/requests/sr_new");
    expect(result.recentResponses[0]?.respondedAtLabel).toBe(
      "Nov 16, 2026, 10:30 AM",
    );
  });
});
