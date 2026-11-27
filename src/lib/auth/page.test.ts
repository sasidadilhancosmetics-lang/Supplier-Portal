import { describe, expect, it } from "vitest";
import { AuthorizationError } from "./errors";
import { loadProtectedPage, rethrowPageAuthError } from "./page";

describe("protected page error handling", () => {
  it("redirects before a generic page fallback can swallow authentication", () => {
    expect(() => rethrowPageAuthError(new AuthorizationError("UNAUTHENTICATED")))
      .toThrow("NEXT_REDIRECT");
  });
  it("preserves redirects already thrown by a loader", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/auth/login;307;" });
    await expect(loadProtectedPage(async () => { throw redirect; })).rejects.toBe(redirect);
  });
  it("leaves non-auth domain errors available to the existing fallback", () => {
    expect(rethrowPageAuthError(new Error("domain failure"))).toBeUndefined();
  });
  it("does not redirect SDK or other operational failures", async () => {
    const failure = new Error("sanitized operational failure");
    await expect(loadProtectedPage(async () => { throw failure; })).rejects.toBe(failure);
  });
});
