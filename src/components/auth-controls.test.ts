import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthState } from "@/lib/auth/types";

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, ...props }: { children: React.ReactNode }) =>
    createElement("a", { ...props, "data-client-link": "true" }, children) };
});
import { AuthControls } from "./auth-controls";

const supplier: AuthState = { status: "provisioned", user: {
  id: "fixture-user", name: null, email: "fixture@example.invalid", companyId: "fixture-company",
  supplierId: "fixture-supplier", role: "SUPPLIER", isActive: true,
} };

describe("authentication navigation controls", () => {
  it.each([supplier, { status: "pending", displayName: null, displayEmail: null } as AuthState])("uses explicit full-document logout without client prefetch", (auth) => {
    const html = renderToStaticMarkup(createElement(AuthControls, { auth }));
    const logout = html.match(/<a\b[^>]*href="\/auth\/logout"[^>]*>/)?.[0];
    expect(logout).toBeDefined();
    expect(logout).not.toContain("data-client-link");
  });
});
