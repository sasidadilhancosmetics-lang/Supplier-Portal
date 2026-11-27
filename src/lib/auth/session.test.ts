import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), find: vi.fn(), update: vi.fn(), supplier: vi.fn() }));
vi.mock("./auth0-session", () => ({ getAuth0Session: mocks.read }));
vi.mock("@/lib/db", () => ({ prisma: {
  externalIdentity: { findUnique: mocks.find, update: mocks.update },
  user: { update: mocks.update }, supplier: { findFirst: mocks.supplier },
} }));

import { getAuthState } from "./session";
import { requireSupplier } from "./guards";
import { loadProtectedPage } from "./page";

const user = { id: "fixture-user", email: "fixture@example.invalid", name: null,
  role: "SUPPLIER", supplierId: "fixture-supplier", companyId: "fixture-company", isActive: true };

describe("session resolution and supplier page authorization", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.read.mockResolvedValue({ user: { sub: "fixture-subject", iss: "https://fixture.invalid/" } });
    mocks.find.mockResolvedValue({ id: "fixture-identity", userId: user.id, user });
    mocks.update.mockResolvedValue({});
    mocks.supplier.mockResolvedValue({ id: user.supplierId, status: "ACTIVE" });
  });

  it("returns anonymous only for a missing session and performs no DB lookup", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await getAuthState()).toEqual({ status: "anonymous" });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("preserves session-read failures, including request-bound control flow", async () => {
    const failure = new Error("sanitized session failure");
    mocks.read.mockRejectedValue(failure);
    await expect(getAuthState()).rejects.toBe(failure);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("resolves a valid issuer/subject mapping without logging identity", async () => {
    expect(await getAuthState()).toEqual({ status: "provisioned", user });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: {
      provider_providerIssuer_providerSubject: { provider: "auth0", providerIssuer: "https://fixture.invalid/", providerSubject: "fixture-subject" },
    } }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("diagnoses missing application user and retains 403 without a login redirect", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(loadProtectedPage(() => requireSupplier())).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(warn.mock.calls).toEqual([["[auth] application_user_missing_or_inactive"], ["[auth] authorization_denied"]]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("distinguishes an application-user lookup failure", async () => {
    mocks.find.mockRejectedValue(new Error("private database details"));
    expect(await getAuthState()).toMatchObject({ status: "pending" });
    expect(warn).toHaveBeenCalledExactlyOnceWith("[auth] application_user_lookup_failed");
  });

  it("redirects an unauthenticated page read through the existing login flow", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(loadProtectedPage(() => requireSupplier())).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/auth/login;307;" });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("retains 403 for a valid user with the wrong role", async () => {
    mocks.find.mockResolvedValue({ user: { ...user, role: "STAFF", supplierId: null } });
    await expect(loadProtectedPage(() => requireSupplier())).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(warn).toHaveBeenCalledWith("[auth] authorization_denied");
    expect(mocks.supplier).not.toHaveBeenCalled();
  });

  it("allows a valid active supplier", async () => {
    expect(await loadProtectedPage(() => requireSupplier())).toEqual(user);
  });
});
