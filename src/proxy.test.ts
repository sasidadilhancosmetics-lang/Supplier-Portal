import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

const middleware = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth0", () => ({ auth0: { middleware } }));
import { proxy } from "./proxy";

const origin = "https://portal.example.invalid";

describe("logout prefetch regression", () => {
  it("reproduces installed SDK logout cookie deletion for a prefetch without contacting Auth0", async () => {
    const sdk = new Auth0Client({
      domain: "auth.example.invalid", clientId: "synthetic-client", clientSecret: "synthetic-secret",
      secret: "a".repeat(64), appBaseUrl: origin,
      customFetch: async () => new Response(JSON.stringify({
        issuer: "https://auth.example.invalid/", authorization_endpoint: "https://auth.example.invalid/authorize",
        token_endpoint: "https://auth.example.invalid/oauth/token", jwks_uri: "https://auth.example.invalid/jwks",
        end_session_endpoint: "https://auth.example.invalid/logout",
      }), { headers: { "Content-Type": "application/json" } }),
    });
    const response = await sdk.middleware(new NextRequest(origin + "/auth/logout", { headers: { "next-router-prefetch": "1", RSC: "1" } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("__session=;");
  });

  const backgroundHeaders: Record<string, string>[] = [
    { "next-router-prefetch": "1" }, { "next-router-segment-prefetch": "/_tree" },
    { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { RSC: "1" },
  ];
  it.each(backgroundHeaders)("does not invoke the logout handler for background requests: %j", async (headers) => {
    middleware.mockClear();
    middleware.mockResolvedValue(NextResponse.next());
    const response = await proxy(new NextRequest(origin + "/auth/logout", { headers }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(middleware).not.toHaveBeenCalled();
  });

  it("retains intentional full-document logout", async () => {
    const response = NextResponse.redirect(origin + "/signed-out");
    middleware.mockResolvedValueOnce(response);
    const request = new NextRequest(origin + "/auth/logout");
    expect(await proxy(request)).toBe(response);
    expect(middleware).toHaveBeenLastCalledWith(request);
  });

  it.each(["/supplier", "/supplier/requests", "/supplier/catalogue", "/supplier/orders", "/supplier/deliveries", "/supplier/notifications", "/supplier/profile"])("preserves cookies and SDK handling for navigation and reload of %s", async (path) => {
    const requests: Record<string, string>[] = [{ cookie: "__session=synthetic-test-cookie", RSC: "1" }, { cookie: "__session=synthetic-test-cookie" }];
    for (const headers of requests) {
      const response = NextResponse.next();
      middleware.mockResolvedValueOnce(response);
      const request = new NextRequest(origin + path, { headers });
      expect(await proxy(request)).toBe(response);
      expect(middleware).toHaveBeenLastCalledWith(request);
      expect(request.headers.get("cookie")).toBe("__session=synthetic-test-cookie");
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
