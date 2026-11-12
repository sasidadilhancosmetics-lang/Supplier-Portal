import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplier: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    brand: { count: vi.fn() },
    supplierBrand: { deleteMany: vi.fn(), createMany: vi.fn() },
    supplierRequest: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireAdmin } from "@/lib/auth/guards";
import { createSupplier, updateSupplierProfile } from "./mutations";

const requireAdminMock = vi.mocked(requireAdmin);

describe("supplier mutation authorization", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
  });

  it("rejects create when requireAdmin throws", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new AuthorizationError("FORBIDDEN"),
    );
    await expect(
      createSupplier({
        name: "Acme",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects update when requireAdmin throws", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new AuthorizationError("UNAUTHENTICATED"),
    );
    await expect(
      updateSupplierProfile({
        supplierId: "sup_1",
        name: "Acme",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
