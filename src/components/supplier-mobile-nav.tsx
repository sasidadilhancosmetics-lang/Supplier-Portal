"use client";

import { Dialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import type { NavItem } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";

function isCurrent(pathname: string, href: string) {
  if (href === "/supplier") return pathname === "/supplier";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function unreadFromNav(navItems: readonly NavItem[]) {
  return (
    navItems.find((i) => i.href === "/supplier/notifications")?.badgeCount ?? 0
  );
}

/**
 * Compact supplier header for narrow viewports: logo, notification bell, menu.
 * Desktop nav stays in SiteHeader.
 */
export function SupplierMobileNav({
  homeHref,
  navItems,
}: {
  homeHref: string;
  navItems: readonly NavItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const unread = unreadFromNav(navItems);

  const close = () => setOpen(false);

  useEffect(() => {
    // Route changes can also come from browser back/forward.
    const closeAfterNavigation = requestAnimationFrame(() => setOpen(false));
    return () => cancelAnimationFrame(closeAfterNavigation);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const desktop = window.matchMedia("(min-width: 48rem)");
    const handleBreakpointChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", handleBreakpointChange);
    return () => desktop.removeEventListener("change", handleBreakpointChange);
  }, [open]);

  return (
    <div className="flex w-full items-center justify-between gap-2 md:hidden">
      <Link
        href={homeHref}
        aria-label="Supplier Portal home"
        className="inline-flex min-h-11 min-w-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <BrandLogo variant="mark" size="sm" animated decorative />
      </Link>

      <div className="flex items-center gap-1">
        <Link
          href="/supplier/notifications"
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications"
          }
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {/* Badge sits beside the icon — never overlays it */}
          <BellIcon />
          {unread > 0 ? (
            <span className="inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger
            aria-label="Open menu"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <MenuIcon />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
            <Dialog.Popup
              initialFocus={closeRef}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col border-l border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] shadow-lg"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <Dialog.Title className="text-base font-medium">
                  Menu
                </Dialog.Title>
                <Dialog.Close
                  ref={closeRef}
                  aria-label="Close menu"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <CloseIcon />
                </Dialog.Close>
              </div>
              <nav aria-label="Supplier" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                <ul className="flex flex-col gap-1">
                  {navItems.map((item) => {
                    const current = isCurrent(pathname, item.href);
                    const showBadge =
                      item.href !== "/supplier/notifications" &&
                      item.badgeCount &&
                      item.badgeCount > 0;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={current ? "page" : undefined}
                          onClick={close}
                          className={cn(
                            "flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                            current
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground hover:bg-secondary",
                          )}
                        >
                          <span>{item.label}</span>
                          {showBadge ? (
                            <span
                              className={cn(
                                "inline-flex min-w-5 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
                                current
                                  ? "bg-primary-foreground text-primary"
                                  : "bg-primary text-primary-foreground",
                              )}
                            >
                              {item.badgeCount! > 99 ? "99+" : item.badgeCount}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="shrink-0 border-t border-border p-3">
                <a
                  href="/auth/logout"
                  onClick={close}
                  className={cn(
                    buttonVariants({
                      variant: "outline",
                      className: "min-h-11 w-full",
                    }),
                  )}
                >
                  Log out
                </a>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}

/**
 * Explicit white fill — Tailwind/currentColor stroke-only icons were invisible
 * on the dark mobile header while the unread badge still showed.
 */
function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      className="shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#FFFFFF"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 1 1-7.48 0 24.585 24.585 0 0 1-4.831-1.244.75.75 0 0 1-.298-1.205A8.217 8.217 0 0 0 5.25 9.75V9Zm4.502 8.9a2.25 2.25 0 1 0 4.496 0 25.057 25.057 0 0 1-4.496 0Z"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      className="shrink-0"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      className="shrink-0"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
