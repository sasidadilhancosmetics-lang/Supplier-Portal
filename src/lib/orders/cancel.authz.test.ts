import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireSupplier: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    purchaseOrder: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    orderItem: { update: vi.fn() },
    availabilityOffer: {
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    availabilityChange: { create: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    idempotencyKey: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createUserNotification: vi.fn(),
}));

vi.mock("@/lib/id", () => ({
  createId: () => "chg_1",
}));

import { Prisma } from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/errors";
import { requireSupplier } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createUserNotification } from "@/lib/notifications";

import { cancelPurchaseOrder, cancelPurchaseOrderForUser } from "./cancel";
import { hashCancelPayload } from "./idempotency";

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

const baseOffer = {
  id: "off_1",
  status: "SUBMITTED",
  quantityOrderedActive: new Prisma.Decimal(10),
  reservedAt: new Date("2026-11-12T00:00:00.000Z"),
  reserveExpiresAt: new Date("2026-11-19T00:00:00.000Z"),
  version: 1,
};

function mockSuccessfulCancelTx(status: "SENT" | "CONFIRMED") {
  vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.idempotencyKey.update).mockResolvedValue({} as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin_1" }] as never);
  vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.orderItem.update).mockResolvedValue({} as never);
  vi.mocked(prisma.availabilityOffer.findUniqueOrThrow).mockResolvedValue(
    baseOffer as never,
  );
  vi.mocked(prisma.availabilityOffer.updateMany).mockResolvedValue({
    count: 1,
  });
  vi.mocked(prisma.availabilityChange.create).mockResolvedValue({} as never);
  vi.mocked(prisma.purchaseOrder.updateMany).mockResolvedValue({ count: 1 });

  const po = {
    id: "po_1",
    orderNumber: "PO-1",
    status,
    version: 1,
    companyId: "co_1",
    supplierId: "sup_1",
    items: [
      {
        id: "oi_1",
        quantityOrdered: new Prisma.Decimal(10),
        quantityCancelled: new Prisma.Decimal(0),
        quantityVerifiedReceived: new Prisma.Decimal(0),
        availabilityOfferId: "off_1",
        availabilityOffer: {
          ...baseOffer,
          requestItem: { requirementItemId: "ri_1" },
        },
      },
    ],
  };

  vi.mocked(prisma.purchaseOrder.findFirst)
    .mockResolvedValueOnce({
      id: "po_1",
      items: [
        {
          id: "oi_1",
          availabilityOfferId: "off_1",
          availabilityOffer: {
            id: "off_1",
            requestItem: { requirementItemId: "ri_1" },
          },
        },
      ],
    } as never)
    .mockResolvedValueOnce(po as never);
}

describe("cancel purchase order authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSup.mockResolvedValue(activeSupplier);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)(prisma),
    );
  });

  it("requires active supplier session", async () => {
    requireSup.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      cancelPurchaseOrder({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_1",
        cancelReason: "Cannot supply",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns NOT_FOUND for cross-supplier orders", async () => {
    vi.mocked(prisma.idempotencyKey.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.purchaseOrder.findFirst).mockResolvedValue(null);

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_other",
        cancelReason: "Cannot supply",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cancel purchase order behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSup.mockResolvedValue(activeSupplier);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn as any)(prisma),
    );
  });

  it("cancels SENT and releases allocation", async () => {
    mockSuccessfulCancelTx("SENT");

    const result = await cancelPurchaseOrderForUser(activeSupplier, {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      purchaseOrderId: "po_1",
      cancelReason: "Stock unavailable",
    });

    expect(result.status).toBe("CANCELLED");
    expect(result.releasedQuantityTotal).toBe("10");
    expect(prisma.availabilityOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          quantityOrderedActive: { gte: expect.anything() },
        }),
        data: expect.objectContaining({
          quantityOrderedActive: expect.anything(),
        }),
      }),
    );
    expect(prisma.availabilityChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: "ORDER_ALLOCATION_RELEASED",
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(createUserNotification).toHaveBeenCalled();
  });

  it("cancels CONFIRMED orders", async () => {
    mockSuccessfulCancelTx("CONFIRMED");

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        purchaseOrderId: "po_1",
        cancelReason: "Capacity change",
      }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("requires a non-empty reason within 500 chars", async () => {
    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        purchaseOrderId: "po_1",
        cancelReason: "",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "44444444-4444-4444-8444-444444444445",
        purchaseOrderId: "po_1",
        cancelReason: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("preserves reserve timestamps and does not reactivate expired offers", async () => {
    mockSuccessfulCancelTx("SENT");
    vi.mocked(prisma.availabilityOffer.findUniqueOrThrow).mockResolvedValue({
      ...baseOffer,
      status: "EXPIRED",
    } as never);

    await cancelPurchaseOrderForUser(activeSupplier, {
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      purchaseOrderId: "po_1",
      cancelReason: "Late cancel",
    });

    expect(prisma.availabilityOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          status: expect.anything(),
          reservedAt: expect.anything(),
          reserveExpiresAt: expect.anything(),
        }),
      }),
    );
    expect(prisma.availabilityChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusBefore: "EXPIRED",
          statusAfter: "EXPIRED",
        }),
      }),
    );
  });

  it("rejects when SUBMITTED delivery holds exist", async () => {
    mockSuccessfulCancelTx("SENT");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { orderItemId: "oi_1", holdQty: new Prisma.Decimal(2) },
    ] as never);

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        purchaseOrderId: "po_1",
        cancelReason: "Trying with hold",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_HOLD" });
  });

  it("rejects release when quantityOrderedActive is below quantityToRelease", async () => {
    mockSuccessfulCancelTx("SENT");
    vi.mocked(prisma.availabilityOffer.findUniqueOrThrow).mockResolvedValue({
      ...baseOffer,
      quantityOrderedActive: new Prisma.Decimal(3),
    } as never);

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        purchaseOrderId: "po_1",
        cancelReason: "Balance mismatch",
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_BALANCE_MISMATCH" });

    expect(prisma.availabilityOffer.updateMany).not.toHaveBeenCalled();
    expect(prisma.availabilityChange.create).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(createUserNotification).not.toHaveBeenCalled();
  });

  it("rejects when conditional allocation release update matches zero rows", async () => {
    mockSuccessfulCancelTx("SENT");
    vi.mocked(prisma.availabilityOffer.updateMany).mockResolvedValue({
      count: 0,
    });

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        purchaseOrderId: "po_1",
        cancelReason: "Race on balance",
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_BALANCE_MISMATCH" });

    expect(prisma.availabilityChange.create).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(createUserNotification).not.toHaveBeenCalled();
  });

  it("replays same key without duplicate side effects", async () => {
    const key = "77777777-7777-4777-8777-777777777777";
    const reason = "Replay reason";
    const hash = hashCancelPayload({
      purchaseOrderId: "po_1",
      cancelReason: reason,
    });
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
          status: "CANCELLED",
          cancelledAt: "2026-11-12T12:00:00.000Z",
          cancelReason: reason,
          releasedQuantityTotal: "10",
        },
      },
    } as never);

    const result = await cancelPurchaseOrderForUser(activeSupplier, {
      idempotencyKey: key,
      purchaseOrderId: "po_1",
      cancelReason: reason,
    });

    expect(result.status).toBe("CANCELLED");
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
        requestHash: "other-hash",
        result: {
          purchaseOrderId: "po_1",
          orderNumber: "PO-1",
          status: "CANCELLED",
          cancelledAt: "2026-11-12T12:00:00.000Z",
          cancelReason: "Other",
          releasedQuantityTotal: "10",
        },
      },
    } as never);

    await expect(
      cancelPurchaseOrderForUser(activeSupplier, {
        idempotencyKey: "88888888-8888-4888-8888-888888888888",
        purchaseOrderId: "po_1",
        cancelReason: "Different reason",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });
});
