import "server-only";

import type { OutboundProvider } from "./schema";

export const mockMessages = {
  MOCK_PASSED: "Mock test passed.",
  CREDENTIALS_REQUIRED: "Configure credentials before testing.",
  AUTH_REJECTED: "The mock rejected authentication.",
  TIMEOUT: "The mock timed out.",
  UNEXPECTED_RESPONSE: "The mock returned an unexpected response.",
  STORE_MISMATCH: "The mock returned a different Shopify store.",
  SCOPE_MISSING: "The mock is missing Shopify product read access.",
  THROTTLED: "The mock reported a rate limit.",
  GRAPHQL_ERROR: "The mock reported a GraphQL error.",
} as const;

export type MockResult = keyof typeof mockMessages;

type MockFixture =
  | { kind: "erp"; authenticatedIdentity: boolean }
  | { kind: "shopify"; origin: string; scopes: readonly string[]; productRead: boolean }
  | { kind: "auth" | "malformed" | "timeout" | "throttled" | "graphqlError" };

export function runMockProviderTest(
  connection: { provider: OutboundProvider; origin: string; credentialsConfigured: boolean },
  fixture: MockFixture = connection.provider === "ERP_NEXT"
    ? { kind: "erp", authenticatedIdentity: true }
    : { kind: "shopify", origin: connection.origin, scopes: ["read_products"], productRead: true },
): MockResult {
  if (!connection.credentialsConfigured) return "CREDENTIALS_REQUIRED";

  switch (fixture.kind) {
    case "auth": return "AUTH_REJECTED";
    case "malformed": return "UNEXPECTED_RESPONSE";
    case "timeout": return "TIMEOUT";
    case "throttled": return "THROTTLED";
    case "graphqlError": return "GRAPHQL_ERROR";
    case "erp":
      if (connection.provider !== "ERP_NEXT") return "UNEXPECTED_RESPONSE";
      return fixture.authenticatedIdentity ? "MOCK_PASSED" : "AUTH_REJECTED";
    case "shopify":
      if (connection.provider !== "SHOPIFY") return "UNEXPECTED_RESPONSE";
      if (fixture.origin !== connection.origin) return "STORE_MISMATCH";
      if (!fixture.scopes.includes("read_products")) return "SCOPE_MISSING";
      return fixture.productRead ? "MOCK_PASSED" : "UNEXPECTED_RESPONSE";
  }
}
