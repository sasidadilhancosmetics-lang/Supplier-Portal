import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireStaffPermission,
  requireStaffPermissions,
  prisma,
} = vi.hoisted(() => ({
  requireStaffPermission: vi.fn(),
  requireStaffPermissions: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission,
  requireStaffPermissions,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  upsertUnreadEntityNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));

import { AuthorizationError } from "@/lib/auth/errors";

import { rejectDelivery, verifyDelivery } from "./verify";

describe("verifyDelivery / rejectDelivery authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          update: vi.fn(),
        },
        delivery: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        $queryRaw: vi.fn(),
      };
      return fn(tx);
    });
  });

  it("requires VERIFY_DELIVERY and ISSUE_GRN together for verify", async () => {
    requireStaffPermissions.mockResolvedValue({
      id: "u_staff",
      companyId: "co_1",
      role: "STAFF",
    });

    await expect(
      verifyDelivery({
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        deliveryId: "del_x",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "1" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(requireStaffPermissions).toHaveBeenCalledWith([
      "VERIFY_DELIVERY",
      "ISSUE_GRN",
    ]);
    expect(requireStaffPermission).not.toHaveBeenCalled();
  });

  it("denies verify when only VERIFY_DELIVERY is granted", async () => {
    requireStaffPermissions.mockRejectedValue(
      new AuthorizationError("FORBIDDEN"),
    );

    await expect(
      verifyDelivery({
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        deliveryId: "del_x",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "1" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("denies verify when only ISSUE_GRN is granted", async () => {
    requireStaffPermissions.mockRejectedValue(
      new AuthorizationError("FORBIDDEN"),
    );

    await expect(
      verifyDelivery({
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        deliveryId: "del_y",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "1" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows ADMIN via requireStaffPermissions bypass path", async () => {
    requireStaffPermissions.mockResolvedValue({
      id: "u_admin",
      companyId: "co_1",
      role: "ADMIN",
    });

    await expect(
      verifyDelivery({
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        deliveryId: "del_z",
        lines: [{ deliveryItemId: "di_1", quantityReceived: "1" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(requireStaffPermissions).toHaveBeenCalled();
  });

  it("reject requires only VERIFY_DELIVERY (no GRN)", async () => {
    requireStaffPermission.mockResolvedValue({
      id: "u_staff",
      companyId: "co_1",
      role: "STAFF",
    });

    await expect(
      rejectDelivery({
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        deliveryId: "del_r",
        discrepancyNotes: "Wrong shipment",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(requireStaffPermission).toHaveBeenCalledWith("VERIFY_DELIVERY");
    expect(requireStaffPermissions).not.toHaveBeenCalled();
  });
});
