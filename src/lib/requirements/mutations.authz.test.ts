import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    brand: { findFirst: vi.fn() },
    product: { findFirst: vi.fn(), findMany: vi.fn() },
    requirement: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    requirementItem: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return fn(prisma);
    }),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  addDraftRequirementItem,
  confirmRequirement,
  createManualDraftRequirement,
  updateDraftRequirementMeta,
} from "./mutations";

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

describe("requirement authorization and draft rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePerm.mockResolvedValue(staffUser);
  });

  it("rejects create when permission missing", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      createManualDraftRequirement({ brandId: "b1", items: [] }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("blocks editing non-draft requirements", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
      brandId: "b1",
      title: "T",
      notes: null,
      items: [],
    } as never);

    await expect(
      updateDraftRequirementMeta({
        requirementId: "req_1",
        title: "Nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });
  });

  it("rejects non-positive quantity via schema", async () => {
    await expect(
      addDraftRequirementItem({
        requirementId: "req_1",
        productId: "p1",
        quantityPlanned: 0,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("prevents duplicate confirmation with claim miss", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "DRAFT",
      companyId: "co_1",
      _count: { items: 2 },
      items: [
        { id: "i1", productId: "p1", quantityPlanned: 2 },
        { id: "i2", productId: "p2", quantityPlanned: 1 },
      ],
    } as never);
    vi.mocked(prisma.requirement.updateMany).mockResolvedValue({ count: 0 });

    await expect(
      confirmRequirement({ requirementId: "req_1" }),
    ).rejects.toMatchObject({ code: "ALREADY_CONFIRMED" });
  });

  it("is idempotent when already confirmed", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "CONFIRMED",
      companyId: "co_1",
      _count: { items: 1 },
      items: [{ id: "i1", productId: "p1", quantityPlanned: 1 }],
    } as never);

    const result = await confirmRequirement({ requirementId: "req_1" });
    expect(result).toMatchObject({ status: "CONFIRMED", already: true });
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
  });

  it("rejects confirm of empty draft", async () => {
    vi.mocked(prisma.requirement.findFirst).mockResolvedValue({
      id: "req_1",
      status: "DRAFT",
      companyId: "co_1",
      _count: { items: 0 },
      items: [],
    } as never);

    await expect(
      confirmRequirement({ requirementId: "req_1" }),
    ).rejects.toMatchObject({ code: "EMPTY_ITEMS" });
  });
});
