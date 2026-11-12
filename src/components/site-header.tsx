"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AuthControls } from "@/components/auth-controls";
import type { AuthState } from "@/lib/auth/types";
import type { PortalArea } from "@/lib/portal-areas";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  auth: AuthState;
  navAreas: readonly PortalArea[];
};

function isCurrent(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({ auth, navAreas }: SiteHeaderProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "Home" },
    ...navAreas.map((area) => ({ href: area.href, label: area.title })),
  ];

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex flex-col">
            <Link
              href="/"
              className="inline-flex w-fit items-center gap-2 rounded-md text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <span
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-sm bg-primary"
              />
              Supplier Portal
            </Link>
            <p className="text-sm text-muted-foreground">
              Procurement workspace
            </p>
          </div>
          <nav aria-label="Portal areas">
            <ul className="flex flex-wrap gap-1">
              {navItems.map((item) => {
                const current = isCurrent(pathname, item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                        current
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <AuthControls auth={auth} />
      </div>
    </header>
  );
}
