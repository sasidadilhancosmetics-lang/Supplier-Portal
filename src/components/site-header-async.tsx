import type { StaffPermissionCode } from "@/generated/prisma/client";

import { BrandLogo } from "@/components/brand-logo";
import { SiteHeader } from "@/components/site-header";
import {
  navItemsForAuth,
  withCompanyNotificationBadge,
  withSupplierNotificationBadge,
} from "@/lib/auth/nav";
import { loadStaffPermissionCodes } from "@/lib/auth/permissions";
import { getAuthState } from "@/lib/auth/session";
import { countUnreadNotificationsForUser } from "@/lib/notifications";

export async function SiteHeaderAsync() {
  const auth = await getAuthState();
  const staffPermissions: ReadonlySet<StaffPermissionCode> =
    auth.status === "provisioned" && auth.user.role === "STAFF"
      ? await loadStaffPermissionCodes(auth.user.id)
      : new Set<StaffPermissionCode>();

  let navItems = navItemsForAuth(auth, staffPermissions);

  if (auth.status === "provisioned") {
    const unread = await countUnreadNotificationsForUser(auth.user.id);
    if (auth.user.role === "SUPPLIER") {
      navItems = withSupplierNotificationBadge(navItems, unread);
    } else if (auth.user.role === "ADMIN" || auth.user.role === "STAFF") {
      navItems = withCompanyNotificationBadge(navItems, unread);
    }
  }

  return <SiteHeader auth={auth} navItems={navItems} />;
}

export function SiteHeaderFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:py-4">
        <div className="max-w-[11rem] sm:max-w-[13.5rem]" aria-hidden>
          <BrandLogo variant="responsive" size="md" decorative />
        </div>
        <div
          className="h-11 w-24 animate-pulse rounded-lg bg-muted"
          aria-hidden
        />
      </div>
    </header>
  );
}
