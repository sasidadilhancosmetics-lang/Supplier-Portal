import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Next installs Node AsyncLocalStorage globally before loading its adapter.
vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
});

const middleware = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth0", () => ({ auth0: { middleware } }));
import { proxy } from "./proxy";

import nextConfig from "../next.config";
import { adapter } from "next/dist/server/web/adapter";

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


// Exercise Next's real header-normalization boundary, not just proxy() directly.
async function throughAdapter(path: string, headers: Record<string, string>) {
  const result = await adapter({
    page: "/proxy", handler: proxy,
    request: { url: origin + path, method: "GET", headers, signal: new AbortController().signal },
  });
  await result.waitUntil;
  return result.response;
}

function useProjectNormalization() {
  vi.stubEnv("__NEXT_NO_MIDDLEWARE_URL_NORMALIZE", nextConfig.skipProxyUrlNormalize ? "true" : undefined);
}

describe("logout security through the Next.js adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reproduces default Flight-header stripping and resulting SDK cookie mutation", async () => {
    vi.stubEnv("__NEXT_NO_MIDDLEWARE_URL_NORMALIZE", undefined);
    middleware.mockReset();
    middleware.mockImplementation(async (request: Request) => {
      expect(request.headers.has("rsc")).toBe(false);
      expect(request.headers.has("next-router-prefetch")).toBe(false);
      const response = NextResponse.redirect(origin + "/signed-out");
      response.cookies.set("__session", "", { maxAge: 0 });
      return response;
    });
    const response = await throughAdapter("/auth/logout", { RSC: "1", "next-router-prefetch": "1" });
    expect(response.status).toBe(307);
    expect(response.headers.has("set-cookie")).toBe(true);
    expect(middleware).toHaveBeenCalledOnce();
  });

  const variants: Record<string, string>[] = [
    { RSC: "1", "next-router-prefetch": "1" }, { RSC: "1" },
    { RSC: "1", "next-router-segment-prefetch": "/_tree" },
    { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" },
  ];
  it.each(variants)("project configuration blocks background logout before SDK: %j", async (headers) => {
    useProjectNormalization();
    middleware.mockReset();
    middleware.mockImplementation(async () => {
      const response = NextResponse.redirect(origin + "/signed-out");
      response.cookies.set("__session", "", { maxAge: 0 });
      return response;
    });
    const incoming = { ...headers, cookie: "__session=synthetic-test-cookie" };
    const response = await throughAdapter("/auth/logout", incoming);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(middleware).not.toHaveBeenCalled();
    expect(incoming.cookie).toBe("__session=synthetic-test-cookie");
  });

  it("preserves explicit document logout and SDK session-cookie removal", async () => {
    useProjectNormalization();
    middleware.mockReset();
    middleware.mockImplementation(async () => {
      const response = NextResponse.redirect(origin + "/signed-out");
      response.cookies.set("__session", "", { maxAge: 0 });
      return response;
    });
    const response = await throughAdapter("/auth/logout", {
      accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
      cookie: "__session=synthetic-test-cookie",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(middleware).toHaveBeenCalledOnce();
  });

  it.each(["/supplier", "/supplier/requests", "/supplier/catalogue", "/supplier/orders", "/supplier/deliveries", "/supplier/notifications", "/supplier/profile"])("preserves SDK cookie access on RSC navigation and document reload of %s", async (path) => {
    useProjectNormalization();
    const variants: Record<string, string>[] = [{ RSC: "1", "next-router-prefetch": "1" }, { accept: "text/html" }];
    for (const headers of variants) {
      middleware.mockReset();
      middleware.mockImplementation(async (request: Request) => {
        expect(new URL(request.url).pathname).toBe(path);
        expect(request.headers.get("cookie")).toBe("__session=synthetic-test-cookie");
        return NextResponse.next();
      });
      const response = await throughAdapter(path, { ...headers, cookie: "__session=synthetic-test-cookie" });
      expect(response.status).toBe(200);
      expect(response.headers.has("location")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(middleware).toHaveBeenCalledOnce();
    }
  });
});
