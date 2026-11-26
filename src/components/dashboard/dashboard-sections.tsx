import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DashboardAlert,
  DashboardQuickAction,
  DashboardRecentRow,
  DashboardStat,
} from "@/lib/dashboards/queries";
import { cn } from "@/lib/utils";

export function DashboardHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-1.5 sm:gap-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
        {description}
      </p>
    </div>
  );
}

export function DashboardAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No alerts right now.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Alerts">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm leading-6",
              alert.tone === "warning"
                ? "border-warning/40 bg-warning/10"
                : "border-border bg-card",
            )}
            role={alert.tone === "warning" ? "alert" : "status"}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{alert.title}</p>
                <p className="text-muted-foreground">{alert.detail}</p>
              </div>
              {alert.href ? (
                <Link
                  href={alert.href}
                  className={cn(
                    buttonVariants({
                      variant: "outline",
                      size: "sm",
                      className: "min-h-11 shrink-0",
                    }),
                  )}
                >
                  Open
                </Link>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardStats({
  stats,
  density = "default",
}: {
  stats: DashboardStat[];
  /** Compact 2-up cards on narrow screens (supplier mobile). */
  density?: "default" | "compact";
}) {
  if (stats.length === 0) return null;

  const compact = density === "compact";

  return (
    <ul
      className={cn(
        "grid list-none gap-2 sm:gap-3",
        compact
          ? "grid-cols-2 lg:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {stats.map((stat) => {
        const body = (
          <>
            <p
              className={cn(
                "text-muted-foreground",
                compact ? "text-xs sm:text-sm" : "text-sm",
              )}
            >
              {stat.label}
            </p>
            <p
              className={cn(
                "font-semibold tabular-nums tracking-tight",
                compact
                  ? "mt-0.5 text-xl sm:mt-1 sm:text-2xl"
                  : "mt-1 text-2xl",
              )}
            >
              {stat.value}
            </p>
            {stat.hint ? (
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
                {stat.hint}
              </p>
            ) : null}
          </>
        );

        return (
          <li key={stat.id}>
            {stat.href ? (
              <Link
                href={stat.href}
                className={cn(
                  "block rounded-xl border border-border bg-card transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  compact ? "px-3 py-2.5 sm:px-4 sm:py-3" : "px-4 py-3",
                )}
              >
                {body}
              </Link>
            ) : (
              <div
                className={cn(
                  "rounded-xl border border-border bg-card",
                  compact ? "px-3 py-2.5 sm:px-4 sm:py-3" : "px-4 py-3",
                )}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardQuickActions({
  actions,
}: {
  actions: DashboardQuickAction[];
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link
          key={action.id}
          href={action.href}
          className={cn(
            buttonVariants({
              variant: action.primary ? "default" : "outline",
              className: "min-h-11",
            }),
          )}
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}

export function DashboardRecentList({
  title,
  empty,
  rows = [],
  viewAllHref,
  viewAllLabel = "View all",
}: {
  title: string;
  empty: string;
  rows?: DashboardRecentRow[];
  viewAllHref?: string;
  viewAllLabel?: string;
}) {
  const list = rows ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {list.length === 0 ? (
            <CardDescription>{empty}</CardDescription>
          ) : null}
        </div>
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className={cn(
              buttonVariants({
                variant: "outline",
                size: "sm",
                className: "min-h-11 shrink-0",
              }),
            )}
          >
            {viewAllLabel}
          </Link>
        ) : null}
      </CardHeader>
      {list.length > 0 ? (
        <CardContent className="pb-4">
          <ul className="divide-y divide-border">
            {list.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href}
                  className="flex flex-col gap-0.5 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <span className="font-medium">{row.title}</span>
                  <span className="text-xs text-muted-foreground">{row.meta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function DashboardSupplierResponses({
  rows,
}: {
  rows: Array<{
    id: string;
    supplierName: string;
    brandName: string;
    requirementTitle: string | null;
    status: string;
    respondedAtLabel: string;
    href: string;
  }>;
}) {
  const mapped: DashboardRecentRow[] = rows.map((row) => ({
    id: row.id,
    title: `${row.supplierName} · ${row.status}`,
    meta: [
      row.brandName,
      row.requirementTitle,
      row.respondedAtLabel,
    ]
      .filter(Boolean)
      .join(" · "),
    href: row.href,
  }));

  return (
    <DashboardRecentList
      title="Recent Supplier Responses"
      empty="No supplier responses yet. Responses appear here when suppliers submit availability."
      rows={mapped}
      viewAllHref="/staff/requests"
      viewAllLabel="View all requests"
    />
  );
}

export function DashboardPriceActions({
  confirmed,
  revised,
}: {
  confirmed: Array<{
    id: string;
    supplierName: string;
    productName: string;
    unitPrice: string;
    currencyCode: string;
    availabilityStatus: string;
    readyForAllocation: boolean;
    reserveLabel: string;
    hrefReview: string;
    hrefAllocate: string | null;
    updatedAtLabel: string;
  }>;
  revised: Array<{
    id: string;
    supplierName: string;
    productName: string;
    unitPrice: string;
    currencyCode: string;
    availabilityStatus: string;
    hrefReview: string;
    updatedAtLabel: string;
  }>;
}) {
  if (confirmed.length === 0 && revised.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No confirmed prices or revised offers waiting for review.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {confirmed.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium">
            Supplier-confirmed prices (offers with uncovered plan)
          </h3>
          <ul className="flex flex-col gap-3">
            {confirmed.map((row) => (
              <li key={row.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-1">
                    <p className="font-medium">
                      {row.supplierName} · {row.productName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {row.unitPrice} {row.currencyCode}
                      {row.readyForAllocation
                        ? " · Ready for Allocation"
                        : ` · ${row.reserveLabel}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.updatedAtLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={row.hrefReview}
                      className={cn(
                        buttonVariants({
                          variant: "outline",
                          className: "min-h-11",
                        }),
                      )}
                    >
                      Review
                    </Link>
                    {row.hrefAllocate ? (
                      <Link
                        href={row.hrefAllocate}
                        className={cn(
                          buttonVariants({ className: "min-h-11" }),
                        )}
                      >
                        Allocate
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {revised.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-medium">
            Revised offers awaiting decision
          </h3>
          <ul className="flex flex-col gap-3">
            {revised.map((row) => (
              <li key={row.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-1">
                    <p className="font-medium">
                      {row.supplierName} · {row.productName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Revised {row.unitPrice} {row.currencyCode} ·{" "}
                      {row.availabilityStatus}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.updatedAtLabel}
                    </p>
                  </div>
                  <Link
                    href={row.hrefReview}
                    className={cn(
                      buttonVariants({ className: "min-h-11" }),
                    )}
                  >
                    Review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardUnavailable({
  items,
}: {
  items: Record<string, string>;
}) {
  const entries = Object.entries(items);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="unavailable-heading">
      <div className="flex items-center gap-2">
        <h2 id="unavailable-heading" className="text-lg font-medium">
          Not available yet
        </h2>
        <Badge variant="secondary">MVP</Badge>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
        {entries.map(([key, text]) => (
          <li key={key}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
