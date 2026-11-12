import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/auth0-session", () => ({
  getAuth0Session: vi.fn(),
}));

vi.mock("@/lib/company", () => ({
  getPurchasingCompanyId: vi.fn(async () => "co_1"),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplier: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn(), create: vi.fn() },
    brand: { count: vi.fn(), findMany: vi.fn() },
    externalIdentity: { findUnique: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return fn(prisma);
    }),
  },
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireAdmin } from "@/lib/auth/guards";
import { getAuth0Session } from "@/lib/auth/auth0-session";
import { prisma } from "@/lib/db";
import {
  approveSupplierRegistration,
  registerSupplierCompany,
  rejectSupplierRegistration,
} from "./registration";

const requireAdminMock = vi.mocked(requireAdmin);
const getSessionMock = vi.mocked(getAuth0Session);

const adminUser = {
  id: "usr_admin",
  companyId: "co_1",
  role: "ADMIN" as const,
  supplierId: null,
  email: "admin@example.com",
  name: "Admin",
  isActive: true,
};

describe("supplier self-registration security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue(adminUser);
  });

  it("requires Auth0 session", async () => {
    getSessionMock.mockResolvedValueOnce(null as never);
    await expect(
      registerSupplierCompany({
        name: "Acme",
        contactName: "Ada",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects unverified email", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: false,
      },
    } as never);

    await expect(
      registerSupplierCompany({
        name: "Acme",
        contactName: "Ada",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
  });

  it("blocks registration when Auth0 identity already linked", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.externalIdentity.findUnique).mockResolvedValue({
      id: "ext_1",
      user: { id: "usr_1", role: "SUPPLIER", supplierId: "sup_1" },
    } as never);

    await expect(
      registerSupplierCompany({
        name: "Acme",
        contactName: "Ada",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toMatchObject({ code: "ALREADY_REGISTERED" });
  });

  it("blocks registration when email belongs to ADMIN/STAFF", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "admin@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.externalIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "usr_admin",
      role: "ADMIN",
    } as never);

    await expect(
      registerSupplierCompany({
        name: "Acme",
        contactName: "Ada",
        supportsAllBrands: false,
        brandIds: [],
      }),
    ).rejects.toMatchObject({ code: "USER_CONFLICT" });
  });

  it("never trusts client role/companyId/supplierId (creates SUPPLIER only)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|new",
        email: "new@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
        name: "New",
      },
    } as never);

    vi.mocked(prisma.externalIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.brand.count).mockResolvedValue(0);
    vi.mocked(prisma.supplier.create).mockResolvedValue({
      id: "sup_new",
      name: "Acme",
      status: "PENDING_REVIEW",
    } as never);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "usr_new" } as never);
    vi.mocked(prisma.externalIdentity.create).mockResolvedValue({
      id: "ext_new",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await registerSupplierCompany({
      name: "Acme",
      contactName: "Ada",
      supportsAllBrands: false,
      brandIds: [],
      // Attempted escalation / spoofing fields (ignored by schema)
      role: "ADMIN",
      companyId: "co_evil",
      supplierId: "sup_evil",
      status: "ACTIVE",
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "SUPPLIER",
          companyId: "co_1",
          email: "new@example.com",
        }),
      }),
    );
    expect(prisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_REVIEW",
          registrationSource: "SELF",
          companyId: "co_1",
        }),
      }),
    );
  });

  it("requires admin for approval and rejection", async () => {
    requireAdminMock.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(approveSupplierRegistration("sup_1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    requireAdminMock.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      rejectSupplierRegistration({
        supplierId: "sup_1",
        reason: "Incomplete details",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("requires a rejection reason", async () => {
    await expect(
      rejectSupplierRegistration({ supplierId: "sup_1", reason: "no" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("approves only PENDING_REVIEW self-registrations", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
      id: "sup_1",
      status: "ACTIVE",
      name: "Acme",
      users: [{ id: "usr_1" }],
    } as never);

    const result = await approveSupplierRegistration("sup_1");
    expect(result).toMatchObject({ status: "ACTIVE", already: true });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it("rejects concurrent second approval after claim fails", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
      id: "sup_1",
      status: "PENDING_REVIEW",
      name: "Acme",
      users: [{ id: "usr_1" }],
    } as never);
    vi.mocked(prisma.supplier.updateMany).mockResolvedValue({ count: 0 });

    await expect(approveSupplierRegistration("sup_1")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});
