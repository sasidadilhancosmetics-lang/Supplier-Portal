"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AuthControls } from "@/components/auth-controls";
import { BrandLogo } from "@/components/brand-logo";
import { CompanyNavigation } from "@/components/company-navigation";
import { SupplierMobileNav } from "@/components/supplier-mobile-nav";
import type { AuthState } from "@/lib/auth/types";
import type { NavItem } from "@/lib/auth/nav";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  auth: AuthState;
  navItems: readonly NavItem[];
};

function isCurrent(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  if (href === "/admin" || href === "/staff" || href === "/supplier") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function homeHrefForAuth(auth: AuthState) {
  if (auth.status !== "provisioned") return "/";
  if (auth.user.role === "ADMIN") return "/admin";
  if (auth.user.role === "STAFF") return "/staff";
  if (auth.user.role === "SUPPLIER") return "/supplier";
  return "/";
}

export function SiteHeader({ auth, navItems }: SiteHeaderProps) {
  const pathname = usePathname();
  const homeHref = homeHrefForAuth(auth);
  const isSupplier =
    auth.status === "provisioned" && auth.user.role === "SUPPLIER";

  if (
    auth.status === "provisioned" &&
    (auth.user.role === "ADMIN" || auth.user.role === "STAFF") &&
    ["/admin", "/staff"].some((area) => pathname === area || pathname.startsWith(`${area}/`))
  ) {
    return <CompanyNavigation auth={auth} navItems={navItems} pathname={pathname} homeHref={homeHref} />;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-5xl px-4 py-3 sm:py-4">
        {isSupplier ? (
          <>
            <SupplierMobileNav homeHref={homeHref} navItems={navItems} />
            {/* Desktop supplier nav */}
            <div className="hidden items-center justify-between gap-4 md:flex">
              <div className="flex min-w-0 items-center gap-6">
                <Link
                  href={homeHref}
                  aria-label="Supplier Portal home"
                  className="inline-flex w-fit max-w-[13.5rem] items-center rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <BrandLogo variant="full" size="md" animated decorative />
                </Link>
                {navItems.length > 0 ? (
                  <DesktopNav pathname={pathname} navItems={navItems} />
                ) : null}
              </div>
              <AuthControls auth={auth} />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <Link
                href={homeHref}
                aria-label="Supplier Portal home"
                className="inline-flex w-fit max-w-[11rem] items-center rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:max-w-[13.5rem]"
              >
                <BrandLogo variant="responsive" size="md" animated decorative />
              </Link>
              {navItems.length > 0 ? (
                <DesktopNav pathname={pathname} navItems={navItems} />
              ) : null}
            </div>
            <AuthControls auth={auth} />
          </div>
        )}
      </div>
    </header>
  );
}

function DesktopNav({
  pathname,
  navItems,
}: {
  pathname: string;
  navItems: readonly NavItem[];
}) {
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-wrap gap-1">
        {navItems.map((item) => {
          const current = isCurrent(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  current
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-secondary",
                )}
              >
                {item.label}
                {item.badgeCount && item.badgeCount > 0 ? (
                  <span
                    className={cn(
                      "inline-flex min-w-5 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
                      current
                        ? "bg-primary-foreground text-primary"
                        : "bg-primary text-primary-foreground",
                    )}
                    aria-label={`${item.badgeCount} unread`}
                  >
                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
