import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    idempotencyKey: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { confirmOsfImport } from "./confirm";
import { OsfImportDomainError } from "./errors";

const requirePerm = vi.mocked(requireStaffPermission);

describe("confirmOsfImport authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires CONFIRM_REQUIREMENT", async () => {
    requirePerm.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    await expect(
      confirmOsfImport({
        importId: "imp",
        importVersion: 1,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(requirePerm).toHaveBeenCalledWith("CONFIRM_REQUIREMENT");
  });

  it("rejects invalid payloads before DB work", async () => {
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
      confirmOsfImport({
        importId: "imp",
        importVersion: 1,
        idempotencyKey: "not-a-uuid",
      }),
    ).rejects.toBeInstanceOf(OsfImportDomainError);
  });

  it("locks the authenticated company before any confirmation writes", async () => {
    requirePerm.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: null,
      role: "STAFF",
      companyId: "actor-company",
      supplierId: null,
      isActive: true,
    });
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
    const queryRaw = vi.fn().mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockImplementation((async (
      operation: (tx: Pick<typeof prisma, "$queryRaw">) => Promise<unknown>,
    ) => operation({ $queryRaw: queryRaw })) as typeof prisma.$transaction,
    );

    await expect(confirmOsfImport({
      importId: "imp",
      importVersion: 1,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [statement, companyId, lock] = queryRaw.mock.calls[0];
    expect((statement as TemplateStringsArray).join("?")).toContain('FROM "Company" WHERE id = ?');
    expect(companyId).toBe("actor-company");
    expect(lock.sql).toBe("FOR NO KEY UPDATE");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
