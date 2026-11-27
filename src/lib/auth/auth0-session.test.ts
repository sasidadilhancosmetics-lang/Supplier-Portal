import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), connection: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.read } }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { AuthSessionReadError, getAuth0Session } from "./auth0-session";

describe("request-bound Auth0 session reads", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.cookies.mockResolvedValue({ getAll: () => [] });
    mocks.read.mockResolvedValue(null);
  });

  it("distinguishes absent cookies from an unreadable/expired session", async () => {
    expect(await getAuth0Session()).toBeNull();
    expect(warn).toHaveBeenLastCalledWith("[auth] session_cookie_missing");
    mocks.cookies.mockResolvedValue({ getAll: () => [{ name: "__session", value: "private-cookie" }] });
    expect(await getAuth0Session()).toBeNull();
    expect(warn).toHaveBeenLastCalledWith("[auth] session_missing");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-cookie");
  });

  it.each(["__session__0", "appSession", "appSession.0"])("recognizes SDK session cookie %s", async (name) => {
    mocks.cookies.mockResolvedValue({ getAll: () => [{ name }] });
    await getAuth0Session();
    expect(warn).toHaveBeenCalledExactlyOnceWith("[auth] session_missing");
  });

  it("returns a valid session unchanged without logging identity data", async () => {
    const session = { user: { sub: "synthetic-subject", email: "fixture@example.invalid" } };
    mocks.read.mockResolvedValue(session);
    expect(await getAuth0Session()).toBe(session);
    expect(warn).not.toHaveBeenCalled();
  });

  it("diagnoses missing subject separately", async () => {
    mocks.read.mockResolvedValue({ user: {} });
    await getAuth0Session();
    expect(warn).toHaveBeenCalledExactlyOnceWith("[auth] session_subject_missing");
  });

  it("sanitizes SDK failures rather than treating them as logout", async () => {
    mocks.read.mockRejectedValue(new Error("private-token fixture@example.invalid"));
    await expect(getAuth0Session()).rejects.toBeInstanceOf(AuthSessionReadError);
    await expect(getAuth0Session()).rejects.toThrow("Authentication session could not be read.");
    expect(warn.mock.calls).toEqual([["[auth] session_read_failed"], ["[auth] session_read_failed"]]);
  });

  it("preserves request/prerender control flow before reading sessions", async () => {
    const control = new Error("request boundary");
    mocks.connection.mockRejectedValue(control);
    await expect(getAuth0Session()).rejects.toBe(control);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not sanitize a Next.js redirect raised during session reading", async () => {
    const control = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/auth/login;307;" });
    mocks.read.mockRejectedValue(control);
    await expect(getAuth0Session()).rejects.toBe(control);
    expect(warn).not.toHaveBeenCalled();
  });
});
