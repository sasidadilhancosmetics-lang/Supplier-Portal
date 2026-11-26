import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireSupplier: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplier: { findFirst: vi.fn() },
    brand: { findMany: vi.fn(), count: vi.fn() },
    supplierRequest: { findMany: vi.fn() },
    supplierBrand: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return operation(prisma);
    }),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireSupplier } from "@/lib/auth/guards";
import {
  getOwnSupplierProfile,
  updateOwnSupplierProfile,
} from "./supplier-self";

const requireSupplierMock = vi.mocked(requireSupplier);

describe("supplier self-service authorization", () => {
  beforeEach(() => {
    requireSupplierMock.mockReset();
  });

  it("denies profile read when requireSupplier fails (disabled/cross-role)", async () => {
    requireSupplierMock.mockRejectedValueOnce(
      new AuthorizationError("FORBIDDEN"),
    );
    await expect(getOwnSupplierProfile()).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("denies profile update when requireSupplier fails", async () => {
    requireSupplierMock.mockRejectedValueOnce(
      new AuthorizationError("FORBIDDEN"),
    );
    await expect(
      updateOwnSupplierProfile({
        name: "Acme",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("uses supplierId from authenticated user, not client input", async () => {
    requireSupplierMock.mockResolvedValueOnce({
      id: "usr_s",
      companyId: "co_1",
      role: "SUPPLIER",
      supplierId: "sup_owned",
      email: "s@example.com",
      name: "S",
      isActive: true,
    });

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "sup_owned" }]);
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(null);

    await expect(
      updateOwnSupplierProfile({
        name: "Hacked",
        supportsAllBrands: false,
        brandIds: [],
        supplierId: "sup_other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sup_owned", companyId: "co_1" },
      }),
    );
  });
});
