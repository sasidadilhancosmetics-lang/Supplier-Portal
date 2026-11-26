import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    requirement: { findFirst: vi.fn() },
    supplier: { findMany: vi.fn() },
    supplierRequest: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { create: vi.fn() },
    $queryRaw: vi.fn(),
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
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  distributeRequirement,
  listMatchingSuppliersForRequirement,
} from "./distribute";

const requirePerm = vi.mocked(requireStaffPermission);

const staffUser = {
  id: "usr_staff",
  companyId: "co_1",
  role: "STAFF" as const,
  supplierId: null,
  email: "staff@example.com",
  name: "Staff",
  isActive: true,
};

describe("distribute authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePerm.mockResolvedValue(staffUser);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "sup_1" }]);
  });

  it("requires SEND_SUPPLIER_REQUEST for preview", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      listMatchingSuppliersForRequirement("req_1"),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(requirePerm).toHaveBeenCalledWith("SEND_SUPPLIER_REQUEST");
  });

  it("requires SEND_SUPPLIER_REQUEST for distribute", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      distributeRequirement({
        requirementId: "req_1",
        mode: "ALL_MATCHING",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects distributing a non-confirmed requirement", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "DRAFT",
      brandId: "b1",
      brand: { id: "b1", name: "Brand" },
      title: "T",
      items: [],
    } as never);

    await expect(
      listMatchingSuppliersForRequirement("req_1"),
    ).rejects.toMatchObject({ code: "NOT_CONFIRMED" });
  });

  it("nested RequestItem create omits companyId/supplierId (composite FK)", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
      brandId: "b1",
      brand: { id: "b1", name: "Brand" },
      title: "T",
      items: [
        {
          id: "ri_1",
          quantityPlanned: "10",
          product: {
            id: "p1",
            name: "Item",
            sku: null,
            priorityStatus: "NORMAL",
          },
        },
      ],
    } as never);
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([
      {
        id: "sup_1",
        name: "Buddy Store",
        status: "ACTIVE",
        supportsAllBrands: true,
        brands: [],
      },
    ] as never);
    vi.mocked(prisma.supplierRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.supplierRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.supplierRequest.create).mockResolvedValue({
      id: "sr_1",
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await distributeRequirement({
      requirementId: "req_1",
      mode: "ALL_MATCHING",
    });

    expect(prisma.supplierRequest.create).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(prisma.supplierRequest.create).mock.calls[0]?.[0] as {
      data: {
        items: { create: Array<Record<string, unknown>> };
      };
    };
    const nested = createArg.data.items.create[0];
    expect(nested).toMatchObject({
      requirementItemId: "ri_1",
      productId: "p1",
    });
    expect(nested).not.toHaveProperty("companyId");
    expect(nested).not.toHaveProperty("supplierId");
  });

  it("passes responseDeadline through to SupplierRequest create", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
      brandId: "b1",
      brand: { id: "b1", name: "Brand" },
      title: "T",
      items: [
        {
          id: "ri_1",
          quantityPlanned: "10",
          product: {
            id: "p1",
            name: "Item",
            sku: null,
            priorityStatus: "NORMAL",
          },
        },
      ],
    } as never);
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([
      {
        id: "sup_1",
        name: "Buddy Store",
        status: "ACTIVE",
        supportsAllBrands: true,
        brands: [],
      },
    ] as never);
    vi.mocked(prisma.supplierRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.supplierRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.supplierRequest.create).mockResolvedValue({
      id: "sr_1",
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await distributeRequirement({
      requirementId: "req_1",
      mode: "ALL_MATCHING",
      responseDeadline: "2026-11-14T06:39",
    });

    const createArg = vi.mocked(prisma.supplierRequest.create).mock.calls[0]?.[0] as {
      data: { responseDeadline: Date | null };
    };
    expect(createArg.data.responseDeadline).toBeInstanceOf(Date);
    expect(createArg.data.responseDeadline?.toISOString()).toBe(
      new Date("2026-11-14T06:39").toISOString(),
    );
  });
});
