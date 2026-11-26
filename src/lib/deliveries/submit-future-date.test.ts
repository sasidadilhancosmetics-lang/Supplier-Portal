import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireSupplier, prisma } = vi.hoisted(() => ({
  requireSupplier: vi.fn(),
  prisma: { $transaction: vi.fn() },
}));

vi.mock("@/lib/auth/guards", () => ({ requireSupplier }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  upsertUnreadEntityNotification: vi.fn(),
}));

import { todayCalendarDateInPortalTz } from "@/lib/dates";

import { submitDelivery } from "./submit";

describe("submitDelivery future actual date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSupplier.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      supplierId: "sup_1",
      role: "SUPPLIER",
    });
  });

  it("rejects future actual delivery dates before writing", async () => {
    const today = todayCalendarDateInPortalTz();
    const [y, m, d] = today.split("-").map(Number);
    const future = new Date(Date.UTC(y!, m! - 1, d! + 2));
    const futureStr = `${future.getUTCFullYear()}-${String(future.getUTCMonth() + 1).padStart(2, "0")}-${String(future.getUTCDate()).padStart(2, "0")}`;

    await expect(
      submitDelivery({
        idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        purchaseOrderId: "po_1",
        deliveredAt: futureStr,
        confirmed: true,
        lines: [{ orderItemId: "oi_1", quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Actual delivery date cannot be in the future.",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
