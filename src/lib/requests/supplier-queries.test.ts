import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireSupplier, prisma } = vi.hoisted(() => ({
  requireSupplier: vi.fn(),
  prisma: {
    supplierRequest: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    priceAgreement: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    ),
  },
}));

vi.mock("@/lib/auth/guards", () => ({ requireSupplier }));
vi.mock("@/lib/db", () => ({ prisma }));

import { listSupplierRequestsForSupplier } from "./supplier-queries";

const listRow = (
  id: string,
  status: string,
  hasCounter: boolean,
) => ({
  id,
  status,
  brand: { id: "b1", name: "Brand" },
  _count: { items: 1 },
  responseDeadline: null,
  sentAt: new Date(),
  respondedAt: status === "RESPONDED" ? new Date() : null,
  items: [
    {
      availabilityOffer: hasCounter
        ? { priceAgreement: { status: "COUNTER_PENDING" } }
        : null,
    },
  ],
});

describe("listSupplierRequestsForSupplier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupplier.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      supplierId: "sup_1",
      role: "SUPPLIER",
    });
    prisma.$transaction.mockImplementation(
      async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    );
  });

  it("filters Action Required to open requests and pending counters", async () => {
    prisma.supplierRequest.findMany
      .mockResolvedValueOnce([{ id: "sr_open" }])
      .mockResolvedValueOnce([
        listRow("sr_open", "NEW", false),
        listRow("sr_counter", "RESPONDED", true),
      ]);
    prisma.priceAgreement.findMany.mockResolvedValue([
      {
        availabilityOffer: {
          requestItem: { supplierRequestId: "sr_counter" },
        },
      },
    ]);
    prisma.supplierRequest.count.mockResolvedValue(2);

    const result = await listSupplierRequestsForSupplier({
      status: "ACTION_REQUIRED",
      page: 1,
    });

    expect(result.status).toBe("ACTION_REQUIRED");
    expect(result.items.map((i) => i.id).sort()).toEqual([
      "sr_counter",
      "sr_open",
    ]);
    expect(
      result.items.find((i) => i.id === "sr_counter")?.hasPendingCounter,
    ).toBe(true);
    expect(prisma.supplierRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "co_1",
          supplierId: "sup_1",
          id: { in: expect.arrayContaining(["sr_open", "sr_counter"]) },
        }),
      }),
    );
  });

  it("scopes normal list to session company + supplier", async () => {
    prisma.supplierRequest.count.mockResolvedValue(0);
    prisma.supplierRequest.findMany.mockResolvedValue([]);

    await listSupplierRequestsForSupplier({ page: 1 });

    expect(prisma.supplierRequest.count).toHaveBeenCalledWith({
      where: { companyId: "co_1", supplierId: "sup_1" },
    });
  });

  it("ALL filter returns every status without status predicate", async () => {
    prisma.supplierRequest.count.mockResolvedValue(1);
    prisma.supplierRequest.findMany.mockResolvedValue([
      listRow("sr_done", "RESPONDED", false),
    ]);

    const result = await listSupplierRequestsForSupplier({
      status: "ALL",
      page: 1,
    });

    expect(result.status).toBe("ALL");
    expect(result.items).toHaveLength(1);
    expect(prisma.supplierRequest.count).toHaveBeenCalledWith({
      where: { companyId: "co_1", supplierId: "sup_1" },
    });
  });
});
