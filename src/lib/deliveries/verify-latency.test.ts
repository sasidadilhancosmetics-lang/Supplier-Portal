import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { prisma, writeAuditLog, upsertUnreadEntityNotification } = vi.hoisted(() => ({
  prisma: { $transaction: vi.fn() }, writeAuditLog: vi.fn(), upsertUnreadEntityNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog }));
vi.mock("@/lib/notifications", () => ({ upsertUnreadEntityNotification }));
vi.mock("@/lib/auth/guards", () => ({ requireStaffPermission: vi.fn(), requireStaffPermissions: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { verifyDeliveryForUser } from "./verify";

const staff = { id: "staff", companyId: "company", role: "STAFF" as const, email: "test@example.invalid", name: null, supplierId: null, isActive: true };
const input = {
  idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deliveryId: "delivery",
  receivedAt: "2026-11-27", lines: [{ deliveryItemId: "line", quantityReceived: "10" }],
};

function initialState() {
  return { received: 0, deliveryStatus: "SCHEDULED", lineStatus: "ACTIVE", orderStatus: "CONFIRMED",
    grns: [] as unknown[], audits: [] as string[], notifications: 0, receipt: null as null | Record<string, unknown> };
}

/** Synthetic transactional storage with virtual 350ms database round trips; no network or wall-clock sleeps. */
function slowDatabase(failAtCompletion = false, roundTripMs = 350) {
  let committed = initialState();
  const durations: number[] = [];
  prisma.$transaction.mockImplementation(async (callback, options) => {
    const pending = structuredClone(committed);
    let elapsed = 0;
    const query = <T>(operation: () => T) => vi.fn(async () => {
      elapsed += roundTripMs;
      if (elapsed > (options?.timeout ?? 5_000)) {
        throw new Prisma.PrismaClientKnownRequestError("Synthetic transaction expired", { code: "P2028", clientVersion: "test" });
      }
      return operation();
    });
    const orderLine = () => ({ id: "order-line", quantityOrdered: new Prisma.Decimal(10),
      quantityCancelled: new Prisma.Decimal(0), quantityVerifiedReceived: new Prisma.Decimal(pending.received),
      unitPrice: new Prisma.Decimal(125), status: pending.lineStatus });
    const delivery = () => ({ id: "delivery", companyId: "company", supplierId: "supplier", purchaseOrderId: "order",
      status: pending.deliveryStatus, notes: null, scheduleApprovedAt: null,
      purchaseOrder: { id: "order", orderNumber: "TEST-PO", status: pending.orderStatus, version: 1, requiresScheduleApproval: false },
      items: [{ id: "line", orderItemId: "order-line", quantityDelivered: new Prisma.Decimal(10),
        orderItem: { ...orderLine(), productId: "product", product: { name: "Synthetic product", erpItemId: null } } }],
    });
    const tx = {
      $queryRaw: query(() => []),
      idempotencyKey: {
        findUnique: query(() => pending.receipt),
        create: vi.fn(async ({ data }) => query(() => { pending.receipt = data; })()),
        update: vi.fn(async ({ data }) => query(() => {
          if (failAtCompletion) throw new Error("Synthetic failure after GRN creation");
          pending.receipt = data;
        })()),
      },
      delivery: {
        findFirst: query(delivery),
        update: vi.fn(async ({ data }) => query(() => { pending.deliveryStatus = data.status; })()),
      },
      orderItem: {
        findMany: query(() => [orderLine()]),
        update: vi.fn(async ({ data }) => query(() => {
          expect(data).not.toHaveProperty("unitPrice");
          if (data.quantityVerifiedReceived) pending.received += Number(data.quantityVerifiedReceived.increment);
          if (data.status) pending.lineStatus = data.status;
          return orderLine();
        })()),
      },
      purchaseOrder: { update: vi.fn(async ({ data }) => query(() => { pending.orderStatus = data.status; })()) },
      grn: {
        findUnique: query(() => null), findFirst: query(() => null),
        create: vi.fn(async ({ data }) => query(() => { pending.grns.push(JSON.parse(JSON.stringify(data))); })()),
      },
      user: { findMany: query(() => [{ id: "supplier-user" }]) },
    };
    writeAuditLog.mockImplementation(async ({ tx: actualTx, action }) => {
      expect(actualTx).toBe(tx);
      await query(() => { pending.audits.push(action); })();
    });
    upsertUnreadEntityNotification.mockImplementation(async ({ tx: actualTx }) => {
      expect(actualTx).toBe(tx);
      await query(() => { pending.notifications++; })();
    });
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
    try {
      const result = await callback(tx);
      committed = pending;
      return result;
    } finally {
      durations.push(elapsed);
    }
  });
  return { state: () => committed, durations };
}

describe("receipt verification over a slower database connection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("issues one GRN beyond five seconds, preserves the price snapshot, and replays without counting twice", async () => {
    const db = slowDatabase();
    const result = await verifyDeliveryForUser(staff, input);
    expect(db.durations[0]).toBeGreaterThan(5_000);
    expect(result.status).toBe("VERIFIED");
    expect(db.state()).toMatchObject({ received: 10, deliveryStatus: "VERIFIED", lineStatus: "FULFILLED", orderStatus: "DELIVERED", notifications: 1 });
    expect(db.state().grns).toHaveLength(1);
    expect(db.state().audits).toEqual(["DELIVERY_VERIFIED", "GRN_ISSUED"]);
    expect(await verifyDeliveryForUser(staff, input)).toEqual(result);
    expect(db.state().received).toBe(10);
    expect(db.state().grns).toHaveLength(1);
    expect(db.state().notifications).toBe(1);
  });

  it("rolls back quantities, GRN, audit, notifications and idempotency claim if the transaction fails late", async () => {
    const db = slowDatabase(true);
    await expect(verifyDeliveryForUser(staff, input)).rejects.toThrow("Synthetic failure after GRN creation");
    expect(db.durations[0]).toBeGreaterThan(5_000);
    expect(db.state()).toEqual(initialState());
  });

  it("keeps a finite timeout and bounded retries when latency exceeds the receipt budget", async () => {
    const db = slowDatabase(false, 5_000);
    await expect(verifyDeliveryForUser(staff, input)).rejects.toMatchObject({ code: "P2028" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(db.state()).toEqual(initialState());
  });
});
