import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireSupplier: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    purchaseOrder: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    idempotencyKey: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createUserNotification: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireSupplier } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createUserNotification } from "@/lib/notifications";

import { confirmPurchaseOrder, confirmPurchaseOrderForUser } from "./confirm";
import { hashConfirmPayload } from "./idempotency";
import { OrderDomainError } from "./errors";

const requireSup = vi.mocked(requireSupplier);

const activeSupplier = {
  id: "usr_sup",
  companyId: "co_1",
  role: "SUPPLIER" as const,
  supplierId: "sup_1",
  email: "sup@example.com",
  name: "Supplier",
  isActive: true,
};

describe("confirm purchase order authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSup.mockResolvedValue(activeSupplier);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)(prisma),
    );
  });

  it("requires an active supplier session", async () => {
    requireSup.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      confirmPurchaseOrder({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_1",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns NOT_FOUND for cross-supplier orders", async () => {
    vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(null);

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("confirm purchase order transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSup.mockResolvedValue(activeSupplier);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)(prisma),
    );
    vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.idempotencyKey.update).mockResolvedValue({} as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
  });

  it("confirms SENT → CONFIRMED without changing line quantities", async () => {
    const now = new Date("2026-11-12T12:00:00.000Z");
    vi.setSystemTime(now);

    const items = [
      {
        id: "oi_1",
        quantityOrdered: { toString: () => "10" },
        quantityCancelled: { toString: () => "0" },
        availabilityOfferId: "off_1",
      },
    ];

    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: "po_1",
      orderNumber: "PO-1",
      status: "SENT",
      version: 1,
      companyId: "co_1",
      supplierId: "sup_1",
      items,
    } as never);
    vi.mocked(prisma.purchaseOrder.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.purchaseOrder.findUniqueOrThrow).mockResolvedValue({
      id: "po_1",
      orderNumber: "PO-1",
      status: "CONFIRMED",
      confirmedAt: now,
      companyId: "co_1",
      supplierId: "sup_1",
      items,
    } as never);
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "admin_1" }] as never)
      .mockResolvedValueOnce([{ id: "staff_alloc" }] as never);

    const result = await confirmPurchaseOrderForUser(activeSupplier, {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      purchaseOrderId: "po_1",
    });

    expect(result).toMatchObject({
      status: "CONFIRMED",
      purchaseOrderId: "po_1",
      orderNumber: "PO-1",
    });
    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SENT", supplierId: "sup_1" }),
        data: expect.objectContaining({
          status: "CONFIRMED",
          version: { increment: 1 },
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(createUserNotification).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("allows confirmation regardless of reserve expiry (allocation already done)", async () => {
    // No reserve field is consulted in confirm — SENT alone is enough.
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: "po_1",
      orderNumber: "PO-1",
      status: "SENT",
      version: 1,
      companyId: "co_1",
      supplierId: "sup_1",
      items: [],
    } as never);
    vi.mocked(prisma.purchaseOrder.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.purchaseOrder.findUniqueOrThrow).mockResolvedValue({
      id: "po_1",
      orderNumber: "PO-1",
      status: "CONFIRMED",
      confirmedAt: new Date(),
      companyId: "co_1",
      supplierId: "sup_1",
      items: [],
    } as never);

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
        purchaseOrderId: "po_1",
      }),
    ).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("rejects invalid transitions", async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: "po_1",
      status: "CANCELLED",
      version: 1,
      companyId: "co_1",
      supplierId: "sup_1",
      items: [],
    } as never);

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        purchaseOrderId: "po_1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });

  it("rejects already confirmed when using a new idempotency key", async () => {
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue({
      id: "po_1",
      status: "CONFIRMED",
      companyId: "co_1",
      supplierId: "sup_1",
      items: [],
    } as never);

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        purchaseOrderId: "po_1",
      }),
    ).rejects.toBeInstanceOf(OrderDomainError);
  });

  it("treats concurrent lost update as conflict", async () => {
    vi.mocked(prisma.purchaseOrder.findFirst)
      .mockResolvedValueOnce({ id: "po_1" } as never)
      .mockResolvedValueOnce({
        id: "po_1",
        status: "SENT",
        version: 1,
        companyId: "co_1",
        supplierId: "sup_1",
        items: [],
      } as never)
      .mockResolvedValueOnce({
        id: "po_1",
        status: "CONFIRMED",
        companyId: "co_1",
        supplierId: "sup_1",
      } as never);
    vi.mocked(prisma.purchaseOrder.updateMany).mockResolvedValue({ count: 0 });

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
        purchaseOrderId: "po_1",
      }),
    ).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });
  });

  it("replays same key without duplicate side effects", async () => {
    const key = "55555555-5555-4555-8555-555555555555";
    const hash = hashConfirmPayload({ purchaseOrderId: "po_1" });
    vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      id: "ik_1",
      expiresAt: new Date(Date.now() + 86400000),
      responseJson: {
        status: "complete",
        requestHash: hash,
        result: {
          purchaseOrderId: "po_1",
          orderNumber: "PO-1",
          status: "CONFIRMED",
          confirmedAt: "2026-11-12T12:00:00.000Z",
        },
      },
    } as never);

    const result = await confirmPurchaseOrderForUser(activeSupplier, {
      idempotencyKey: key,
      purchaseOrderId: "po_1",
    });

    expect(result.orderNumber).toBe("PO-1");
    expect(prisma.purchaseOrder.updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(createUserNotification).not.toHaveBeenCalled();
  });

  it("rejects same key with different payload", async () => {
    vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      id: "ik_1",
      expiresAt: new Date(Date.now() + 86400000),
      responseJson: {
        status: "complete",
        requestHash: "different-hash",
        result: {
          purchaseOrderId: "po_other",
          orderNumber: "PO-X",
          status: "CONFIRMED",
          confirmedAt: "2026-11-12T12:00:00.000Z",
        },
      },
    } as never);

    await expect(
      confirmPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        purchaseOrderId: "po_1",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });
});
