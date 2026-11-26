import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    brand: { findMany: vi.fn() },
    requirement: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { loadRequirementsIndexPage } from "./queries";

const requirePerm = vi.mocked(requireStaffPermission);

const confirmOnlyStaff = {
  id: "usr_confirm",
  companyId: "co_1",
  role: "STAFF" as const,
  supplierId: null,
  email: "confirm@example.com",
  name: "Confirm",
  isActive: true,
};

describe("loadRequirementsIndexPage authorization alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (ops) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Promise.all(ops as any);
    });
    vi.mocked(prisma.requirement.count).mockResolvedValue(1);
    vi.mocked(prisma.requirement.findMany).mockResolvedValue([
      {
        id: "req_1",
        title: "Shampoo",
        status: "CONFIRMED",
        confirmedAt: new Date("2026-11-12T00:00:00.000Z"),
        createdAt: new Date("2026-11-11T00:00:00.000Z"),
        brand: { id: "br_1", name: "Ceravie" },
        _count: { items: 1 },
      },
    ] as never);
    vi.mocked(prisma.brand.findMany).mockResolvedValue([
      { id: "br_1", name: "Ceravie" },
    ] as never);
  });

  it("loads list and brand filters for CONFIRM_REQUIREMENT staff without MANAGE", async () => {
    requirePerm.mockImplementation(async (code) => {
      if (code === "MANAGE_REQUIREMENTS") {
        throw new AuthorizationError("FORBIDDEN");
      }
      if (code === "CONFIRM_REQUIREMENT") {
        return confirmOnlyStaff;
      }
      throw new AuthorizationError("FORBIDDEN");
    });

    const page = await loadRequirementsIndexPage({});

    expect(page.result.items).toHaveLength(1);
    expect(page.result.items[0]?.title).toBe("Shampoo");
    expect(page.brands).toEqual([{ id: "br_1", name: "Ceravie" }]);
    // Single auth path — brands query is not gated on MANAGE alone.
    expect(prisma.brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "co_1" },
      }),
    );
  });
});
