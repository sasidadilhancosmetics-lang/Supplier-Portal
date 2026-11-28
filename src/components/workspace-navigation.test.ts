import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { navItemsForAuth, withSupplierNotificationBadge } from "@/lib/auth/nav";
import type { AuthState } from "@/lib/auth/types";

const route = vi.hoisted(() => ({ pathname: "/supplier" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({
  default: ({ children, onNavigate, ...props }: { children: ReactNode; onNavigate?: () => void }) => {
    void onNavigate;
    return createElement("a", props, children);
  },
}));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => createElement("span", null, "Supplier Portal") }));

import { SiteHeader } from "./site-header";

const supplier: AuthState = { status: "provisioned", user: {
  id: "fixture-user", name: "Test Supplier", email: "fixture@example.invalid", companyId: "fixture-company",
  supplierId: "fixture-supplier", role: "SUPPLIER", isActive: true,
} };

function render(pathname: string, auth = supplier) {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(SiteHeader, {
    auth, navItems: withSupplierNotificationBadge(navItemsForAuth(auth), 3),
  }));
}

describe("Supplier workspace sidebar", () => {
  it("renders all seven Supplier destinations and unread notifications using the shared sidebar", () => {
    const html = render("/supplier");
    expect(html).toContain('aria-label="Supplier"');
    expect(html).toContain('aria-controls="supplier-sidebar-links"');
    expect(html).toContain('aria-label="Open supplier menu"');
    expect(html).toContain('aria-label="Notifications, 3 unread"');
    for (const item of navItemsForAuth(supplier)) expect(html).toContain(`href="${item.href}"`);
    expect(html).not.toContain('href="/admin');
    expect(html).not.toContain('href="/staff');
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain('href="/auth/logout"'); // Account popup controls logout, never a prefetched nav item.
  });

  it.each(["requests", "catalogue", "orders", "deliveries", "notifications", "profile"])(
    "highlights %s on nested pages rather than Dashboard", (section) => {
      const html = render(`/supplier/${section}/fixture`);
      const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(activeLinks.length).toBeGreaterThan(0);
      for (const link of activeLinks) expect(link).toContain(`href="/supplier/${section}"`);
    },
  );

  it("preserves the Company sidebar and its notification destination", () => {
    if (supplier.status !== "provisioned") throw new Error("Expected fixture user");
    const admin: AuthState = { ...supplier, user: { ...supplier.user, role: "ADMIN", supplierId: null } };
    const html = render("/staff/orders", admin);
    expect(html).toContain('aria-label="Company"');
    expect(html).toContain('aria-label="Open company menu"');
    expect(html).toContain("Purchase Orders");
    expect(html).not.toContain('href="/supplier/');
  });

  it("leaves the public header outside the Supplier workspace", () => {
    expect(render("/")).not.toContain('class="company-sidebar');
    expect(render("/supplier", { status: "anonymous" })).not.toContain('class="company-sidebar');
  });
});
