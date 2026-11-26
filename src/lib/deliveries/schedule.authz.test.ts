import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockRequireSupplier,
  mockTransaction,
  mockFindFirst,
  mockLockPo,
  mockLockItems,
  mockHolds,
} = vi.hoisted(() => ({
  mockRequireSupplier: vi.fn(),
  mockTransaction: vi.fn(),
  mockFindFirst: vi.fn(),
  mockLockPo: vi.fn(),
  mockLockItems: vi.fn(),
  mockHolds: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireSupplier: (...args: unknown[]) => mockRequireSupplier(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("./locks", () => ({
  lockPurchaseOrderForUpdate: (...args: unknown[]) => mockLockPo(...args),
  lockOrderItemsForUpdate: (...args: unknown[]) => mockLockItems(...args),
}));

vi.mock("./holds", () => ({
  loadSubmittedDeliveryHolds: (...args: unknown[]) => mockHolds(...args),
}));

vi.mock("./idempotency", async () => {
  const actual = await vi.importActual<typeof import("./idempotency")>(
    "./idempotency",
  );
  return {
    ...actual,
    claimScheduleIdempotency: vi.fn(async () => ({
      kind: "claim",
      scope: "delivery.schedule:u1",
      key: "k",
      requestHash: "h",
    })),
    completeScheduleIdempotency: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  upsertUnreadEntityNotification: vi.fn(),
}));
vi.mock("./notifications", () => ({
  resolveCompanyDeliveryNotificationRecipients: vi.fn(async () => []),
}));
vi.mock("@/lib/id", () => ({ createId: () => "del_new" }));

import { Prisma } from "@/generated/prisma/client";

import { scheduleDeliveryForUser } from "./schedule";

describe("scheduleDeliveryForUser authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHolds.mockResolvedValue(new Map());
  });

  it("scopes to session supplier and returns NOT_FOUND cross-supplier", async () => {
    const user = {
      id: "u1",
      companyId: "co_1",
      supplierId: "su_1",
      role: "SUPPLIER" as const,
      email: "s@example.com",
      name: null,
      isActive: true,
    };
    mockRequireSupplier.mockResolvedValue(user);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        purchaseOrder: { findFirst: mockFindFirst },
        delivery: { create: vi.fn() },
      };
      mockFindFirst.mockResolvedValueOnce(null);
      return fn(tx);
    });

    await expect(
      scheduleDeliveryForUser(user, {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_other",
        plannedDeliveryAt: "2099-01-15",
        confirmed: true,
        lines: [{ orderItemId: "oi_1", quantity: "2" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects over-allocation against remaining capacity", async () => {
    const user = {
      id: "u1",
      companyId: "co_1",
      supplierId: "su_1",
      role: "SUPPLIER" as const,
      email: "s@example.com",
      name: null,
      isActive: true,
    };
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        purchaseOrder: { findFirst: mockFindFirst },
        delivery: { create: vi.fn() },
      };
      mockFindFirst
        .mockResolvedValueOnce({ id: "po_1" })
        .mockResolvedValueOnce({
          id: "po_1",
          companyId: "co_1",
          supplierId: "su_1",
          status: "CONFIRMED",
          orderNumber: "PO-1",
          items: [
            {
              id: "oi_1",
              quantityOrdered: new Prisma.Decimal(5),
              quantityCancelled: new Prisma.Decimal(0),
              quantityVerifiedReceived: new Prisma.Decimal(0),
              status: "ACTIVE",
            },
          ],
        });
      mockHolds.mockResolvedValue(
        new Map([["oi_1", new Prisma.Decimal(3)]]),
      );
      return fn(tx);
    });

    await expect(
      scheduleDeliveryForUser(user, {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_1",
        plannedDeliveryAt: "2099-01-15",
        confirmed: true,
        lines: [{ orderItemId: "oi_1", quantity: "3" }],
      }),
    ).rejects.toMatchObject({ code: "OVER_DELIVERY" });
  });
});
