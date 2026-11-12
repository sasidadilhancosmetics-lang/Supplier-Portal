import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/auth0-session", () => ({
  getAuth0Session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    supplier: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    supplierInvitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    externalIdentity: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
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
import { InvitationError } from "./errors";
import {
  acceptSupplierInvitation,
  createSupplierInvitation,
  revokeSupplierInvitation,
  setSupplierUserActive,
} from "./service";

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

describe("invitation service authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue(adminUser);
  });

  it("rejects invite creation when not admin", async () => {
    requireAdminMock.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      createSupplierInvitation({
        supplierId: "sup_1",
        email: "a@example.com",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects revoke when not admin", async () => {
    requireAdminMock.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(revokeSupplierInvitation("inv_1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("rejects disable when not admin", async () => {
    requireAdminMock.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      setSupplierUserActive({
        userId: "usr_1",
        supplierId: "sup_1",
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("blocks duplicate active invitations", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
      id: "sup_1",
      companyId: "co_1",
      name: "Acme",
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.supplierInvitation.findFirst).mockResolvedValue({
      id: "inv_existing",
    } as never);

    await expect(
      createSupplierInvitation({
        supplierId: "sup_1",
        email: "a@example.com",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PENDING" });
  });

  it("blocks inviting an email already used by another role/supplier", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
      id: "sup_1",
      companyId: "co_1",
      name: "Acme",
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "usr_other",
      role: "ADMIN",
      supplierId: null,
      companyId: "co_1",
    } as never);

    await expect(
      createSupplierInvitation({
        supplierId: "sup_1",
        email: "admin@example.com",
      }),
    ).rejects.toMatchObject({ code: "USER_CONFLICT" });
  });
});

describe("invitation acceptance security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires Auth0 session before accept", async () => {
    getSessionMock.mockResolvedValueOnce(null as never);
    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("rejects unverified Auth0 email", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: false,
      },
    } as never);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "EMAIL_UNVERIFIED",
    });
  });

  it("rejects expired invitations (token replay after expiry)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.supplierInvitation.findUnique).mockResolvedValue({
      id: "inv_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() - 60_000),
      invitedEmail: "a@example.com",
      role: "SUPPLIER",
      supplierId: "sup_1",
      companyId: "co_1",
      acceptedUserId: null,
    } as never);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });

  it("rejects email mismatch (no email-only linking)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "other@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.supplierInvitation.findUnique).mockResolvedValue({
      id: "inv_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      invitedEmail: "a@example.com",
      role: "SUPPLIER",
      supplierId: "sup_1",
      companyId: "co_1",
      acceptedUserId: null,
    } as never);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "EMAIL_MISMATCH",
    });
  });

  it("rejects Auth0 identity already linked to another supplier", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.supplierInvitation.findUnique).mockResolvedValue({
      id: "inv_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      invitedEmail: "a@example.com",
      role: "SUPPLIER",
      supplierId: "sup_b",
      companyId: "co_1",
      acceptedUserId: null,
    } as never);

    vi.mocked(prisma.externalIdentity.findUnique).mockResolvedValue({
      id: "ext_1",
      userId: "usr_other",
      user: {
        id: "usr_other",
        role: "SUPPLIER",
        supplierId: "sup_a",
      },
    } as never);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "IDENTITY_IN_USE",
    });
  });

  it("rejects non-SUPPLIER invitation roles", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|1",
        email: "a@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.supplierInvitation.findUnique).mockResolvedValue({
      id: "inv_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      invitedEmail: "a@example.com",
      role: "ADMIN",
      supplierId: "sup_1",
      companyId: "co_1",
      acceptedUserId: null,
    } as never);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "INVALID_ROLE",
    });
  });

  it("rejects token replay after acceptance by a different Auth0 subject", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        sub: "auth0|attacker",
        email: "a@example.com",
        email_verified: true,
        iss: "https://example.auth0.com/",
      },
    } as never);

    vi.mocked(prisma.supplierInvitation.findUnique).mockResolvedValue({
      id: "inv_1",
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 60_000),
      invitedEmail: "a@example.com",
      role: "SUPPLIER",
      supplierId: "sup_1",
      companyId: "co_1",
      acceptedUserId: "usr_legit",
    } as never);

    vi.mocked(prisma.externalIdentity.findFirst).mockResolvedValue(null);

    await expect(acceptSupplierInvitation("a".repeat(32))).rejects.toMatchObject({
      code: "ALREADY_ACCEPTED",
    });
  });
});

describe("InvitationError codes used by acceptance", () => {
  it("exposes expected security codes", () => {
    const codes = [
      "EXPIRED",
      "REVOKED",
      "EMAIL_MISMATCH",
      "EMAIL_UNVERIFIED",
      "IDENTITY_IN_USE",
      "INVALID_ROLE",
      "ALREADY_ACCEPTED",
    ] as const;
    for (const code of codes) {
      expect(new InvitationError(code, code).code).toBe(code);
    }
  });
});
