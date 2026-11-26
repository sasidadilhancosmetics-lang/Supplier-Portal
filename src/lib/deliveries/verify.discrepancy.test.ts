import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prisma, writeAuditLog, upsertUnreadEntityNotification } = vi.hoisted(
  () => ({
    prisma: { $transaction: vi.fn() },
    writeAuditLog: vi.fn(),
    upsertUnreadEntityNotification: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog }));
vi.mock("@/lib/notifications", () => ({
  upsertUnreadEntityNotification,
  createUserNotification: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
  requireStaffPermissions: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";

import { verifyDeliveryForUser } from "./verify";

describe("verify discrepancy and empty received", () => {
  const staff = {
    id: "u_staff",
    companyId: "co_1",
    role: "STAFF" as const,
    email: "s@example.com",
    name: null,
    supplierId: null,
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires discrepancy notes when received differs from submitted", async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const deliveryItem = {
        id: "di_1",
        orderItemId: "oi_1",
        quantityDelivered: new Prisma.Decimal(5),
        orderItem: {
          id: "oi_1",
          productId: "pr_1",
          quantityOrdered: new Prisma.Decimal(10),
          quantityCancelled: new Prisma.Decimal(0),
          quantityVerifiedReceived: new Prisma.Decimal(0),
          unitPrice: new Prisma.Decimal("10"),
          status: "ACTIVE",
          product: { name: "Serum", erpItemId: null },
        },
      };
      const tx = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          update: vi.fn(),
        },
        delivery: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: "del_1",
              purchaseOrderId: "po_1",
            })
            .mockResolvedValueOnce({
              id: "del_1",
              companyId: "co_1",
              supplierId: "sup_1",
              status: "SUBMITTED",
              notes: null,
              purchaseOrderId: "po_1",
              purchaseOrder: {
                id: "po_1",
                orderNumber: "PO-1",
                status: "CONFIRMED",
                version: 1,
                supplierId: "sup_1",
                companyId: "co_1",
              },
              items: [deliveryItem],
            }),
          update: vi.fn(),
        },
        orderItem: {
          findMany: vi.fn(),
          update: vi.fn(),
        },
        grn: { findUnique: vi.fn(), create: vi.fn() },
        user: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRaw: vi.fn(),
      };
      return fn(tx);
    });

    await expect(
      verifyDeliveryForUser(staff, {
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        deliveryId: "del_1",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "3" }],
      }),
    ).rejects.toMatchObject({ code: "DISCREPANCY_NOTES_REQUIRED" });
  });

  it("requires discrepancy notes for explicit zero received", async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const deliveryItem = {
        id: "di_1",
        orderItemId: "oi_1",
        quantityDelivered: new Prisma.Decimal(5),
        orderItem: {
          id: "oi_1",
          productId: "pr_1",
          quantityOrdered: new Prisma.Decimal(10),
          quantityCancelled: new Prisma.Decimal(0),
          quantityVerifiedReceived: new Prisma.Decimal(0),
          unitPrice: new Prisma.Decimal("10"),
          status: "ACTIVE",
          product: { name: "Serum", erpItemId: null },
        },
      };
      const tx = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          update: vi.fn(),
        },
        delivery: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: "del_1",
              purchaseOrderId: "po_1",
            })
            .mockResolvedValueOnce({
              id: "del_1",
              companyId: "co_1",
              supplierId: "sup_1",
              status: "SUBMITTED",
              notes: null,
              purchaseOrderId: "po_1",
              purchaseOrder: {
                id: "po_1",
                orderNumber: "PO-1",
                status: "CONFIRMED",
                version: 1,
                supplierId: "sup_1",
                companyId: "co_1",
              },
              items: [deliveryItem],
            }),
          update: vi.fn(),
        },
        orderItem: {
          findMany: vi.fn(),
          update: vi.fn(),
        },
        grn: { findUnique: vi.fn(), create: vi.fn() },
        user: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRaw: vi.fn(),
      };
      return fn(tx);
    });

    await expect(
      verifyDeliveryForUser(staff, {
        idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        deliveryId: "del_1",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "0" }],
      }),
    ).rejects.toMatchObject({ code: "DISCREPANCY_NOTES_REQUIRED" });
  });
});
