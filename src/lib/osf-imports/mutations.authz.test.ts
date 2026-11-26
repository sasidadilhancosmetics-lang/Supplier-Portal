import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    osfImport: { findFirst: vi.fn() },
    osfImportLine: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/products/mutations", () => ({
}));

vi.mock("@/lib/brands/queries", () => ({
  createBrandForCompany: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";

import { OsfImportDomainError } from "./errors";
import {
  excludeImportLine,
  includeZeroQtyLine,
  updateImportLineQuantity,
} from "./mutations";

const requirePerm = vi.mocked(requireStaffPermission);

describe("osf import mutations authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires MANAGE_REQUIREMENTS for quantity updates", async () => {
    requirePerm.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(
      updateImportLineQuantity({
        importId: "imp",
        lineId: "line",
        lineVersion: 1,
        importVersion: 1,
        quantityPlanned: 2,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(requirePerm).toHaveBeenCalledWith("MANAGE_REQUIREMENTS");
  });

  it("requires MANAGE_REQUIREMENTS for exclude", async () => {
    requirePerm.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(
      excludeImportLine({
        importId: "imp",
        lineId: "line",
        lineVersion: 1,
        importVersion: 1,
        reason: "not needed",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects invalid quantity payloads before DB work", async () => {
    requirePerm.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: null,
      role: "STAFF",
      companyId: "co",
      supplierId: null,
      isActive: true,
    });
    await expect(
      updateImportLineQuantity({
        importId: "imp",
        lineId: "line",
        lineVersion: 1,
        importVersion: 1,
        quantityPlanned: 0,
      }),
    ).rejects.toBeInstanceOf(OsfImportDomainError);
  });

  it("requires MANAGE_REQUIREMENTS for zero-qty include", async () => {
    requirePerm.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(
      includeZeroQtyLine({
        importId: "imp",
        lineId: "line",
        lineVersion: 1,
        importVersion: 1,
        quantityPlanned: 3,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

});
