import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireSupplier,
  prisma,
  writeAuditLog,
  upsertUnreadEntityNotification,
} = vi.hoisted(() => ({
  requireSupplier: vi.fn(),
  writeAuditLog: vi.fn(),
  upsertUnreadEntityNotification: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/guards", () => ({ requireSupplier }));
vi.mock("@/lib/audit", () => ({ writeAuditLog }));
vi.mock("@/lib/notifications", () => ({
  upsertUnreadEntityNotification,
  createUserNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));

import { DeliveryDomainError } from "./errors";
import { submitDelivery } from "./submit";

describe("submitDelivery authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes to session supplier and returns NOT_FOUND cross-supplier", async () => {
    requireSupplier.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      supplierId: "sup_a",
      role: "SUPPLIER",
    });

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
          update: vi.fn(),
        },
        purchaseOrder: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        $queryRaw: vi.fn(),
      };
      return fn(tx);
    });

    await expect(
      submitDelivery({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        purchaseOrderId: "po_other",
        deliveredAt: "2026-11-10",
        confirmed: true,
        lines: [{ orderItemId: "oi_1", quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DeliveryDomainError>);
  });
});
