import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    brand: { findFirst: vi.fn() },
    product: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return fn(prisma);
    }),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { updateProduct } from "./mutations";

const requirePerm = vi.mocked(requireStaffPermission);

describe("product mutation authorization", () => {
  beforeEach(() => {
    requirePerm.mockReset();
  });

  it("rejects update without MANAGE_PRODUCTS", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      updateProduct({
        productId: "p1",
        name: "Serum",
        brandId: "b1",
        priorityStatus: "NORMAL",
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
