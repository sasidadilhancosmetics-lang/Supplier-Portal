"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AuthControls } from "@/components/auth-controls";
import { BrandLogo } from "@/components/brand-logo";
import { activeCompanyDestination, groupCompanySidebar, type NavItem } from "@/lib/auth/nav";
import type { AuthState } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

import "./company-navigation.css";

const iconPaths: Record<string, string> = {
  Dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  "Supplier Management": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  Products: "M21 8l-9 5-9-5m9 5v9m9-14-9-5-9 5v9l9 5 9-5zM7.5 5.5l9 5",
  Catalogue: "M21 8l-9 5-9-5m9 5v9m9-14-9-5-9 5v9l9 5 9-5zM7.5 5.5l9 5",
  Requests: "M4 4h16v13H8l-4 4zM8 8h8m-8 4h5",
  Orders: "M6 7h12l2 14H4zM9 9V6a3 3 0 0 1 6 0v3",
  Profile: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  "OSF Imports": "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  Requirements: "M9 4H5v17h14V4h-4m-6 0a3 3 0 0 1 6 0v2H9zM8 11h8m-8 5h8",
  "Supplier Requests": "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  "Purchase Orders": "M6 7h12l2 14H4zM9 9V6a3 3 0 0 1 6 0v3",
  Deliveries: "M3 5h12v12H3zM15 9h3l3 3v5h-6m-7 0a2 2 0 1 1-4 0m16 0a2 2 0 1 1-4 0",
  Integrations: "M12 22v-4m-5-9v4a5 5 0 0 0 10 0V9M5 9h14M9 9V3m6 6V3",
  "Product Price Comparison": "M3 4v16h18M8 16v-3m5 3V7m5 9V4",
  Notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  Account: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  Menu: "M4 6h16M4 12h16M4 18h16",
  Close: "m6 6 12 12M18 6 6 18",
  Collapse: "M3 4h18v16H3zM9 4v16m8-11-3 3 3 3",
  Expand: "M3 4h18v16H3zM9 4v16m5-11 3 3-3 3",
};

const desktopQuery = "(min-width: 64rem)";
const buttonClass = "inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name] ?? iconPaths.Dashboard} />
    </svg>
  );
}

function SidebarLinks({ groups, current, compact, onNavigate, id, label }: {
  groups: ReturnType<typeof groupCompanySidebar>;
  current?: string;
  compact?: boolean;
  onNavigate?: () => void;
  id?: string;
  label: string;
}) {
  return (
    <nav id={id} aria-label={label} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
      {groups.map(({ label, links }) => (
        <div key={label ?? "Dashboard"} className={label ? "border-t border-sidebar-border pt-2" : undefined}>
          {label ? (
            <p className={compact ? "sr-only" : "px-3 pb-1 text-xs font-semibold text-muted-foreground"}>
              {label}
            </p>
          ) : null}
          <ul className="grid gap-1" aria-label={label ?? undefined}>
            {links.map((item) => {
              const active = item.href === current;
              const link = (
                <Link href={item.href} aria-label={compact ? item.label : undefined}
                  aria-current={active ? "page" : undefined} onNavigate={onNavigate}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-ring",
                    compact ? "justify-center" : "px-3",
                    active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}>
                  <Icon name={item.label} />
                  {compact ? null : <span>{item.label}</span>}
                  {!compact && (item.badgeCount ?? 0) > 0 ? (
                    <span aria-label={`${item.badgeCount} unread`} className="ms-auto rounded-md bg-primary px-1.5 text-xs text-primary-foreground">
                      {item.badgeCount! > 99 ? "99+" : item.badgeCount}
                    </span>
                  ) : null}
                </Link>
              );
              return (
                <li key={item.href}>
                  {compact ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger render={link} delay={200} />
                      <Tooltip.Portal>
                        <Tooltip.Positioner side="right" sideOffset={8} className="z-50">
                          <Tooltip.Popup role="tooltip" className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground shadow-md">
                            {item.label}
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  ) : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceNavigation({ auth, navItems, pathname, homeHref, workspace = "company" }: {
  auth: Extract<AuthState, { status: "provisioned" }>;
  navItems: readonly NavItem[];
  pathname: string;
  homeHref: string;
  workspace?: "company" | "supplier";
}) {
  const label = workspace === "supplier" ? "Supplier" : "Company";
  const collapsePreferenceKey = `supplier-portal:${workspace}-sidebar-collapsed`;
  const linksId = `${workspace}-sidebar-links`;
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const previousPathname = useRef(pathname);
  const notifications = navItems.find((item) => item.href === (workspace === "supplier" ? "/supplier/notifications" : "/staff/notifications"));
  const unread = notifications?.badgeCount ?? 0;
  const groups = workspace === "supplier"
    ? [{ label: null, links: [...navItems] }]
    : groupCompanySidebar(navItems, pathname);
  const sidebarItems = groups.flatMap(({ links }) => links);
  const active = activeCompanyDestination(pathname, notifications ? [...sidebarItems, notifications] : sidebarItems);
  const account = auth.user.name ?? auth.user.email;
  const context = active?.label ?? (pathname === "/staff" ? "Dashboard" : `${label} workspace`);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setCollapsed(localStorage.getItem(collapsePreferenceKey) === "true");
      } catch {
        // The sidebar still works when browser storage is blocked.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsePreferenceKey]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(collapsePreferenceKey, String(next));
    } catch {
      // Keep the preference for this visit.
    }
  }

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    const frame = requestAnimationFrame(() => setOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia(desktopQuery);
    const closeAtDesktop = () => { if (desktop.matches) setOpen(false); };
    const closeOnHistory = () => setOpen(false);
    closeAtDesktop();
    desktop.addEventListener("change", closeAtDesktop);
    window.addEventListener("popstate", closeOnHistory);
    return () => {
      desktop.removeEventListener("change", closeAtDesktop);
      window.removeEventListener("popstate", closeOnHistory);
    };
  }, [open]);

  return (
    <>
      <aside data-collapsed={collapsed} className="company-sidebar fixed inset-y-0 start-0 z-30 flex-col border-e border-sidebar-border bg-sidebar">
        <div className={cn("flex shrink-0 border-b border-sidebar-border p-2", collapsed ? "flex-col items-center" : "items-center justify-between gap-1")}>
          <Link href={homeHref} aria-label="Supplier Portal home"
            className={cn(buttonClass, collapsed ? "" : "w-auto min-w-0 flex-1 justify-start px-1")}>
            <BrandLogo variant={collapsed ? "mark" : "full"} size="sm" decorative />
          </Link>
          <button ref={collapseRef} type="button" aria-controls={linksId} aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={buttonClass} onClick={toggleSidebar}>
            <Icon name={collapsed ? "Expand" : "Collapse"} />
          </button>
        </div>
        <SidebarLinks id={linksId} label={label} groups={groups} current={active?.href} compact={collapsed} />
      </aside>

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center gap-1 px-3 sm:gap-3 sm:px-4">
          <Dialog.Root modal open={open} onOpenChange={setOpen}>
            <Dialog.Trigger ref={menuRef} aria-label={`Open ${workspace} menu`} className={cn(buttonClass, "lg:hidden")}>
              <Icon name="Menu" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="company-drawer-backdrop fixed inset-0 z-50 bg-background/80" />
              <Dialog.Popup initialFocus={closeRef}
                finalFocus={() => window.matchMedia(desktopQuery).matches ? collapseRef.current : menuRef.current}
                className="company-drawer fixed inset-y-0 start-0 z-50 flex w-full max-w-[min(18rem,85vw)] flex-col border-e border-sidebar-border bg-sidebar shadow-lg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)]">
                <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-3 py-1">
                  <Dialog.Title className="px-1 text-sm font-semibold">{label} navigation</Dialog.Title>
                  <Dialog.Close ref={closeRef} aria-label={`Close ${workspace} menu`} className={buttonClass}>
                    <Icon name="Close" />
                  </Dialog.Close>
                </div>
                <SidebarLinks label={label} groups={groups} current={active?.href} onNavigate={() => setOpen(false)} />
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>

          <span title={context} className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{context}</span>

          {notifications ? (
            <Link href={notifications.href} aria-current={active === notifications ? "page" : undefined}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              title="Notifications"
              className={cn(buttonClass, "relative", active === notifications && "bg-secondary text-primary")}>
              <Icon name="Notifications" />
              {unread > 0 ? (
                <span aria-hidden="true" className="absolute end-0 top-0 min-w-4 rounded-md bg-primary px-1 text-center text-[10px] font-semibold text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
          ) : null}

          <Popover.Root>
            <Popover.Trigger aria-label={`Account for ${account}`}
              className={cn(buttonClass, "sm:w-auto sm:max-w-52 sm:gap-2 sm:px-2")}>
              <Icon name="Account" />
              <span className="hidden truncate text-sm sm:inline">{account}</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner align="end" sideOffset={8} className="z-50">
                <Popover.Popup aria-label="Signed-in account" className="w-max max-w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-card p-3 shadow-lg">
                  <AuthControls auth={auth} />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>
    </>
  );
}

export { WorkspaceNavigation as CompanyNavigation };
