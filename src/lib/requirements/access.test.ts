import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";

import { requireRequirementReadAccess } from "./access";

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

describe("requireRequirementReadAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to CONFIRM_REQUIREMENT when MANAGE is missing", async () => {
    requirePerm
      .mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"))
      .mockResolvedValueOnce(staffUser);

    await expect(requireRequirementReadAccess()).resolves.toMatchObject({
      id: "usr_staff",
    });
    expect(requirePerm).toHaveBeenNthCalledWith(1, "MANAGE_REQUIREMENTS");
    expect(requirePerm).toHaveBeenNthCalledWith(2, "CONFIRM_REQUIREMENT");
  });

  it("falls back to SEND_SUPPLIER_REQUEST for distribute-only staff", async () => {
    requirePerm
      .mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"))
      .mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"))
      .mockResolvedValueOnce(staffUser);

    await expect(requireRequirementReadAccess()).resolves.toMatchObject({
      id: "usr_staff",
    });
    expect(requirePerm).toHaveBeenLastCalledWith("SEND_SUPPLIER_REQUEST");
  });

  it("does not swallow non-authorization failures from the first permission check", async () => {
    requirePerm.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(requireRequirementReadAccess()).rejects.toThrow(
      "db unavailable",
    );
    expect(requirePerm).toHaveBeenCalledTimes(1);
  });
});
