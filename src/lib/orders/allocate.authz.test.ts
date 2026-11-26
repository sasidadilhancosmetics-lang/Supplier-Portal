import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    availabilityOffer: { findMany: vi.fn() },
    requirementItem: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createUserNotification: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";

import { allocatePurchaseOrder } from "./allocate";
import { OrderDomainError } from "./errors";

const requirePerm = vi.mocked(requireStaffPermission);

describe("allocate authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires ALLOCATE_ORDER before allocating", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));

    await expect(
      allocatePurchaseOrder({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        supplierId: "sup_1",
        lines: [{ availabilityOfferId: "off_1", quantity: "1" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(requirePerm).toHaveBeenCalledWith("ALLOCATE_ORDER");
  });

  it("rejects invalid payload before transaction", async () => {
    requirePerm.mockResolvedValue({
      id: "u1",
      companyId: "co_1",
      role: "STAFF",
      supplierId: null,
      email: "s@x.com",
      name: "Staff",
      isActive: true,
    });

    await expect(
      allocatePurchaseOrder({
        idempotencyKey: "not-a-uuid",
        supplierId: "sup_1",
        lines: [{ availabilityOfferId: "off_1", quantity: "1" }],
      }),
    ).rejects.toBeInstanceOf(OrderDomainError);
  });
});
