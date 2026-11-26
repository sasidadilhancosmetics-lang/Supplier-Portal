import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplier: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("./audit", () => ({
  writeSupplierAuditLog: vi.fn(),
}));

vi.mock("@/lib/osf-imports/suggestion-remap", () => ({
  remapOsfRequestSuggestionsForCosmoIds: vi.fn(async () => ({ updated: 0 })),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { updateSupplierExternalId } from "./mutations";

const requireAdminMock = vi.mocked(requireAdmin);
const prismaMock = prisma as unknown as {
  supplier: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("updateSupplierExternalId authz / domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({
      id: "admin_1",
      companyId: "co_1",
      role: "ADMIN",
    } as never);
  });

  it("rejects non-admin via requireAdmin", async () => {
    requireAdminMock.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(
      updateSupplierExternalId({
        supplierId: "sup_1",
        externalId: "cosmo_1",
        expectedExternalId: null,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects cross-company supplier as NOT_FOUND", async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(null);
    await expect(
      updateSupplierExternalId({
        supplierId: "sup_other",
        externalId: "cosmo_1",
        expectedExternalId: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires confirmation when changing an existing mapping", async () => {
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: "sup_1",
      name: "S",
      externalId: "cosmo_old",
      updatedAt: new Date(),
    });
    await expect(
      updateSupplierExternalId({
        supplierId: "sup_1",
        externalId: "cosmo_new",
        confirmChange: false,
        expectedExternalId: "cosmo_old",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });

  it("rejects stale expectedExternalId", async () => {
    prismaMock.supplier.findFirst.mockResolvedValue({
      id: "sup_1",
      name: "S",
      externalId: "cosmo_actual",
      updatedAt: new Date(),
    });
    await expect(
      updateSupplierExternalId({
        supplierId: "sup_1",
        externalId: "cosmo_new",
        confirmChange: true,
        expectedExternalId: "cosmo_stale",
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_ID_CONFLICT" });
  });

  it("rejects duplicate Cosmo id in the same company", async () => {
    prismaMock.supplier.findFirst
      .mockResolvedValueOnce({
        id: "sup_1",
        name: "S",
        externalId: null,
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({ id: "sup_2", name: "Other" });

    await expect(
      updateSupplierExternalId({
        supplierId: "sup_1",
        externalId: "cosmo_dup",
        expectedExternalId: null,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_EXTERNAL_ID" });
  });
});
