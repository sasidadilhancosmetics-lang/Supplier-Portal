import { afterEach, describe, expect, it, vi } from "vitest";

import { runMockProviderTest } from "./mock-provider";

const erp = { provider: "ERP_NEXT", origin: "https://erp.example.test", credentialsConfigured: true } as const;
const shop = { provider: "SHOPIFY", origin: "https://demo.myshopify.com", credentialsConfigured: true } as const;

afterEach(() => vi.unstubAllGlobals());

describe("offline provider fixtures", () => {
  it("passes both supported success fixtures and handles missing credentials without network", () => {
    const network = vi.fn(() => { throw new Error("Unexpected network call"); });
    vi.stubGlobal("fetch", network);
    expect(runMockProviderTest(erp)).toBe("MOCK_PASSED");
    expect(runMockProviderTest(shop)).toBe("MOCK_PASSED");
    expect(runMockProviderTest({ ...erp, credentialsConfigured: false })).toBe("CREDENTIALS_REQUIRED");
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ["auth", "AUTH_REJECTED"], ["timeout", "TIMEOUT"], ["malformed", "UNEXPECTED_RESPONSE"],
  ] as const)("maps ERPNext %s to %s", (kind, result) => {
    expect(runMockProviderTest(erp, { kind })).toBe(result);
  });

  it.each([
    ["auth", "AUTH_REJECTED"], ["timeout", "TIMEOUT"], ["malformed", "UNEXPECTED_RESPONSE"],
    ["throttled", "THROTTLED"], ["graphqlError", "GRAPHQL_ERROR"],
  ] as const)("maps Shopify %s to %s", (kind, result) => {
    expect(runMockProviderTest(shop, { kind })).toBe(result);
  });

  it("enforces the simulated ERP identity and Shopify shop, scope and read response", () => {
    const fixture = { kind: "shopify", origin: shop.origin, scopes: ["read_products"], productRead: true } as const;
    expect(runMockProviderTest(erp, { kind: "erp", authenticatedIdentity: false })).toBe("AUTH_REJECTED");
    expect(runMockProviderTest(shop, { ...fixture, origin: "https://other.myshopify.com" })).toBe("STORE_MISMATCH");
    expect(runMockProviderTest(shop, { ...fixture, scopes: [] })).toBe("SCOPE_MISSING");
    expect(runMockProviderTest(shop, { ...fixture, productRead: false })).toBe("UNEXPECTED_RESPONSE");
  });
});
