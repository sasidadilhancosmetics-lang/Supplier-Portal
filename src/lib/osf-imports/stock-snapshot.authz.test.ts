import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guards", () => ({ requireStaffPermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { osfImport: { findFirst: vi.fn() } } }));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getOsfImportReview } from "./queries";

beforeEach(() => vi.resetAllMocks());

describe("OSF stock snapshot authorization", () => {
  it("fails before reading a snapshot when Staff has no purchasing permissions", async () => {
    vi.mocked(requireStaffPermission).mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(getOsfImportReview("import")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.osfImport.findFirst).not.toHaveBeenCalled();
  });

  it("selects the requested import by authenticated company, including for Admin", async () => {
    vi.mocked(requireStaffPermission).mockResolvedValue({
      id: "admin", companyId: "company-a", role: "ADMIN",
      supplierId: null, name: "Test Admin", email: "admin@example.invalid", isActive: true,
    });
    vi.mocked(prisma.osfImport.findFirst).mockResolvedValue(null);
    await expect(getOsfImportReview("foreign-import")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.osfImport.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: "company-a", id: "foreign-import" },
    }));
  });
});
