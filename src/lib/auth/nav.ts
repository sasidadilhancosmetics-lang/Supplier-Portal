import type { StaffPermissionCode } from "@/generated/prisma/client";

import type { AuthState } from "@/lib/auth/types";

export type NavItem = {
  href: string;
  label: string;
  /** Optional unread / action badge shown in the header. */
  badgeCount?: number;
};

function hasAny(
  granted: ReadonlySet<StaffPermissionCode>,
  codes: readonly StaffPermissionCode[],
) {
  return codes.some((code) => granted.has(code));
}

/**
 * Role- and permission-aware primary nav.
 * Only links to routes that exist and the user can enter.
 * ADMIN bypasses staff permission gates for staff-area routes.
 */
export function navItemsForAuth(
  auth: AuthState,
  staffPermissions: ReadonlySet<StaffPermissionCode> = new Set(),
): readonly NavItem[] {
  if (auth.status !== "provisioned") {
    return [];
  }

  const role = auth.user.role;

  if (role === "SUPPLIER") {
    return [
      { href: "/supplier", label: "Dashboard" },
      { href: "/supplier/requests", label: "Requests" },
      { href: "/supplier/catalogue", label: "Catalogue" },
      { href: "/supplier/orders", label: "Orders" },
      { href: "/supplier/deliveries", label: "Deliveries" },
      { href: "/supplier/notifications", label: "Notifications" },
      { href: "/supplier/profile", label: "Profile" },
    ];
  }

  if (role === "ADMIN") {
    return [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/suppliers", label: "Suppliers" },
      { href: "/admin/settings/integrations", label: "Integrations" },
      { href: "/staff/osf-imports", label: "OSF Imports" },
      { href: "/staff/requirements", label: "Requirements" },
      { href: "/staff/products", label: "Products" },
      { href: "/staff/requests", label: "Requests" },
      { href: "/staff/orders", label: "Orders" },
      { href: "/staff/deliveries", label: "Deliveries" },
      { href: "/staff/notifications", label: "Notifications" },
    ];
  }

  if (role === "STAFF") {
    const items: NavItem[] = [{ href: "/staff", label: "Dashboard" }];

    if (
      hasAny(staffPermissions, [
        "MANAGE_REQUIREMENTS",
        "CONFIRM_REQUIREMENT",
        "SEND_SUPPLIER_REQUEST",
      ])
    ) {
      items.push({ href: "/staff/osf-imports", label: "OSF Imports" });
      items.push({ href: "/staff/requirements", label: "Requirements" });
    }
    if (staffPermissions.has("MANAGE_PRODUCTS")) {
      items.push({ href: "/staff/products", label: "Products" });
    }
    if (staffPermissions.has("SEND_SUPPLIER_REQUEST")) {
      items.push({ href: "/staff/requests", label: "Requests" });
    }
    if (staffPermissions.has("ALLOCATE_ORDER")) {
      items.push({ href: "/staff/orders", label: "Orders" });
    }
    if (staffPermissions.has("VERIFY_DELIVERY")) {
      items.push({ href: "/staff/deliveries", label: "Deliveries" });
    }
    items.push({ href: "/staff/notifications", label: "Notifications" });

    return items;
  }

  return [];
}

const companySidebarGroups = [
  { label: null, routes: [["/admin"], ["/staff"]] },
  {
    label: "Purchasing",
    routes: [
      ["/staff/osf-imports"],
      ["/staff/requirements"],
      ["/staff/requests", "Supplier Requests"],
      ["/staff/orders", "Purchase Orders"],
      ["/staff/deliveries"],
      ["/staff/products"],
    ],
  },
  { label: "Suppliers", routes: [["/admin/suppliers", "Supplier Management"]] },
  { label: "Insights", routes: [] },
  { label: "Administration", routes: [["/admin/settings/integrations"]] },
] as const;

/** Group only destinations already authorized by navItemsForAuth. */
export function groupCompanySidebar(items: readonly NavItem[], pathname = "") {
  const byHref = new Map(items.map((item) => [item.href, item]));
  const product = /^\/staff\/products\/([^/]+)(\/prices)?\/?$/.exec(pathname);
  // Request access uses the same permission as the per-product price page.
  const priceComparison: NavItem | null = product && product[1] !== "new" &&
    byHref.has("/staff/requests") && (product[2] || byHref.has("/staff/products"))
    ? { href: `/staff/products/${product[1]}/prices`, label: "Product Price Comparison" }
    : null;

  return companySidebarGroups.flatMap(({ label, routes }) => {
    const links = routes.flatMap(([href, caption]) => {
      const item = byHref.get(href);
      return item ? [{ ...item, label: caption ?? item.label }] : [];
    });
    if (label === "Insights" && priceComparison) links.push(priceComparison);
    return links.length ? [{ label, links }] : [];
  });
}

export function activeCompanyDestination(pathname: string, items: readonly NavItem[]) {
  const normalized = pathname.replace(/\/$/, "");
  const exact = items.find(({ href }) => href === normalized);
  if (exact) return exact;

  if (normalized.startsWith("/staff/offers/")) {
    return items.find(({ href }) => href === "/staff/requests");
  }
  return items.find(({ href }) =>
    href !== "/admin" && href !== "/staff" && normalized.startsWith(`${href}/`));
}

/** Default dashboard path after login for a provisioned user. */
export function homeDashboardHref(auth: AuthState): string | null {
  if (auth.status !== "provisioned") return null;
  switch (auth.user.role) {
    case "ADMIN":
      return "/admin";
    case "STAFF":
      return "/staff";
    case "SUPPLIER":
      return "/supplier";
    default:
      return null;
  }
}

/** Attach unread notification badge for supplier nav (session-scoped). */
export function withSupplierNotificationBadge(
  items: readonly NavItem[],
  unreadCount: number,
): readonly NavItem[] {
  if (unreadCount <= 0) return items;
  return items.map((item) =>
    item.href === "/supplier/notifications"
      ? { ...item, badgeCount: unreadCount }
      : item,
  );
}

/** Attach unread badge for company (admin/staff) notifications nav. */
export function withCompanyNotificationBadge(
  items: readonly NavItem[],
  unreadCount: number,
): readonly NavItem[] {
  if (unreadCount <= 0) return items;
  return items.map((item) =>
    item.href === "/staff/notifications"
      ? { ...item, badgeCount: unreadCount }
      : item,
  );
}

/** @deprecated Prefer navItemsForAuth */
export function navAreasForAuth(auth: AuthState) {
  return navItemsForAuth(auth);
}
