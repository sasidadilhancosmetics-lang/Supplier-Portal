import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireSupplier: vi.fn(),
  requireSupplierOwnership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplierRequest: { findFirst: vi.fn() },
    availabilityOffer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    availabilityChange: { create: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return fn(prisma);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createUserNotification: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import {
  requireSupplier,
  requireSupplierOwnership,
} from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  getSupplierRequestForSupplier,
  submitAvailability,
} from "./availability";

const requireOwn = vi.mocked(requireSupplierOwnership);
const requireSup = vi.mocked(requireSupplier);

const supplierUser = {
  id: "usr_sup",
  companyId: "co_1",
  role: "SUPPLIER" as const,
  supplierId: "sup_1",
  email: "sup@example.com",
  name: "Supplier",
  isActive: true,
};

describe("availability authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOwn.mockResolvedValue(supplierUser);
    requireSup.mockResolvedValue(supplierUser);
  });

  it("requires supplier ownership before submit", async () => {
    vi.mocked(prisma.supplierRequest.findFirst).mockResolvedValue({
      supplierId: "sup_1",
    } as never);
    requireOwn.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));

    await expect(
      submitAvailability({
        supplierRequestId: "sr_1",
        lines: [
          {
            requestItemId: "ri_1",
            quantityDeclared: 1,
            unitPrice: 100,
            availableDate: "2026-12-01",
            notAvailable: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("scopes get to the caller's supplier", async () => {
    requireSup.mockResolvedValue(supplierUser);
    vi.mocked(prisma.supplierRequest.findFirst).mockResolvedValue(null);

    await expect(getSupplierRequestForSupplier("sr_missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(prisma.supplierRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sr_missing", supplierId: "sup_1" },
      }),
    );
  });
});
