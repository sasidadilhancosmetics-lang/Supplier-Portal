import { describe, expect, it } from "vitest";

import type { StaffPermissionCode } from "@/generated/prisma/client";
import {
  activeCompanyDestination,
  groupCompanySidebar,
  homeDashboardHref,
  navItemsForAuth,
  withCompanyNotificationBadge,
  withSupplierNotificationBadge,
} from "@/lib/auth/nav";
import type { AuthState, ProvisionedAppUser } from "@/lib/auth/types";

function provisioned(
  role: ProvisionedAppUser["role"],
): Extract<AuthState, { status: "provisioned" }> {
  return {
    status: "provisioned",
    user: {
      id: "u1",
      email: "u@example.com",
      name: "User",
      role,
      companyId: "co1",
      supplierId: role === "SUPPLIER" ? "sup1" : null,
      isActive: true,
    },
  };
}

describe("navItemsForAuth", () => {
  it("returns empty for anonymous and pending", () => {
    expect(navItemsForAuth({ status: "anonymous" })).toEqual([]);
    expect(
      navItemsForAuth({
        status: "pending",
        displayEmail: null,
        displayName: null,
      }),
    ).toEqual([]);
  });

  it("gives ADMIN full company navigation", () => {
    const items = navItemsForAuth(provisioned("ADMIN"));
    expect(items.map((i) => i.href)).toEqual([
      "/admin",
      "/admin/suppliers",
      "/admin/settings/integrations",
      "/staff/osf-imports",
      "/staff/requirements",
      "/staff/products",
      "/staff/requests",
      "/staff/orders",
      "/staff/deliveries",
      "/staff/notifications",
    ]);
  });

  it("filters STAFF nav by permissions", () => {
    const none = navItemsForAuth(provisioned("STAFF"), new Set());
    expect(none.map((i) => i.href)).toEqual([
      "/staff",
      "/staff/notifications",
    ]);

    const granted = new Set<StaffPermissionCode>([
      "MANAGE_PRODUCTS",
      "SEND_SUPPLIER_REQUEST",
      "VERIFY_DELIVERY",
    ]);
    const items = navItemsForAuth(provisioned("STAFF"), granted);
    expect(items.map((i) => i.href)).toEqual([
      "/staff",
      "/staff/osf-imports",
      "/staff/requirements",
      "/staff/products",
      "/staff/requests",
      "/staff/deliveries",
      "/staff/notifications",
    ]);
  });

  it("gives SUPPLIER supplier routes only", () => {
    expect(navItemsForAuth(provisioned("SUPPLIER")).map((i) => i.href)).toEqual(
      [
        "/supplier",
        "/supplier/requests",
        "/supplier/catalogue",
        "/supplier/orders",
        "/supplier/deliveries",
        "/supplier/notifications",
        "/supplier/profile",
      ],
    );
  });

  it("attaches unread badge to Notifications only", () => {
    const items = withSupplierNotificationBadge(
      navItemsForAuth(provisioned("SUPPLIER")),
      4,
    );
    expect(
      items.find((i) => i.href === "/supplier/notifications")?.badgeCount,
    ).toBe(4);
    expect(items.find((i) => i.href === "/supplier")?.badgeCount).toBeUndefined();
  });

  it("attaches company unread badge on staff notifications", () => {
    const items = withCompanyNotificationBadge(
      navItemsForAuth(provisioned("ADMIN")),
      2,
    );
    expect(
      items.find((i) => i.href === "/staff/notifications")?.badgeCount,
    ).toBe(2);
  });
});

describe("homeDashboardHref", () => {
  it("maps roles to dashboards", () => {
    expect(homeDashboardHref(provisioned("ADMIN"))).toBe("/admin");
    expect(homeDashboardHref(provisioned("STAFF"))).toBe("/staff");
    expect(homeDashboardHref(provisioned("SUPPLIER"))).toBe("/supplier");
    expect(homeDashboardHref({ status: "anonymous" })).toBeNull();
  });
});

describe("company sidebar", () => {
  it("groups every authorized Admin destination once, with notifications in the header", () => {
    const items = navItemsForAuth(provisioned("ADMIN"));
    const groups = groupCompanySidebar(items);
    const links = groups.flatMap((group) => group.links);
    expect(groups.map((group) => group.label)).toEqual([null, "Purchasing", "Suppliers", "Administration"]);
    expect(links.map((link) => link.href).sort()).toEqual(
      items.filter((item) => item.href !== "/staff/notifications").map((item) => item.href).sort(),
    );
    expect(links.find((link) => link.href === "/staff/orders")?.label).toBe("Purchase Orders");
  });

  it("omits empty groups and keeps Admin pages out of limited Staff navigation", () => {
    const items = navItemsForAuth(provisioned("STAFF"), new Set(["ALLOCATE_ORDER"]));
    expect(groupCompanySidebar(items)).toEqual([
      { label: null, links: [{ href: "/staff", label: "Dashboard" }] },
      { label: "Purchasing", links: [{ href: "/staff/orders", label: "Purchase Orders" }] },
    ]);
    expect(groupCompanySidebar(navItemsForAuth(provisioned("STAFF")))).toHaveLength(1);
    expect(groupCompanySidebar(navItemsForAuth(provisioned("SUPPLIER")))).toEqual([]);
  });

  it("highlights nested routes and keeps contextual pricing inside authorized sections", () => {
    const admin = navItemsForAuth(provisioned("ADMIN"));
    const staff = navItemsForAuth(provisioned("STAFF"), new Set(["SEND_SUPPLIER_REQUEST"]));
    expect(activeCompanyDestination("/admin/settings/integrations/erp", admin)?.href).toBe("/admin/settings/integrations");
    expect(activeCompanyDestination("/staff/orders/allocate", admin)?.href).toBe("/staff/orders");
    expect(activeCompanyDestination("/staff/offers/offer/negotiate", staff)?.href).toBe("/staff/requests");
    expect(activeCompanyDestination("/staff/products/sku/prices", admin)?.href).toBe("/staff/products");
    expect(activeCompanyDestination("/staff/orders-invalid", admin)).toBeUndefined();
    expect(activeCompanyDestination("/admin/settings/integrations", staff)).toBeUndefined();
  });

  it("exposes Insights only for a product and with the price comparison permission", () => {
    const path = "/staff/products/example/prices";
    const allowed = navItemsForAuth(provisioned("STAFF"), new Set(["SEND_SUPPLIER_REQUEST"]));
    const groups = groupCompanySidebar(allowed, path);
    expect(groups.find((group) => group.label === "Insights")?.links).toEqual([
      { href: path, label: "Product Price Comparison" },
    ]);
    expect(activeCompanyDestination(path, groups.flatMap((group) => group.links))?.href).toBe(path);
    expect(groupCompanySidebar(navItemsForAuth(provisioned("ADMIN")), "/staff/products/example")
      .some((group) => group.label === "Insights")).toBe(true);
    expect(groupCompanySidebar(allowed, "/staff/products/example").some((group) => group.label === "Insights")).toBe(false);
    expect(groupCompanySidebar(allowed, "/staff/products/new").some((group) => group.label === "Insights")).toBe(false);
    const productsOnly = navItemsForAuth(provisioned("STAFF"), new Set(["MANAGE_PRODUCTS"]));
    expect(groupCompanySidebar(productsOnly, path).some((group) => group.label === "Insights")).toBe(false);
  });
});
