import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type {
  ApproachingScheduleRow,
  PendingAvailabilityRequestRow,
  PendingCounterOfferRow,
  PendingOrderConfirmRow,
  PendingScheduleRow,
} from "@/lib/supplier/action-required";
import { cn } from "@/lib/utils";

type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  badge?: string;
  badgeTone?: "urgent" | "default";
  href: string;
  cta: string;
  primary?: boolean;
};

export function ActionRequiredPanel({
  pendingCounters,
  pendingAvailability,
  pendingOrdersToConfirm = [],
  ordersNeedingSchedule = [],
  approachingSchedules = [],
}: {
  pendingCounters: PendingCounterOfferRow[];
  pendingAvailability: PendingAvailabilityRequestRow[];
  pendingOrdersToConfirm?: PendingOrderConfirmRow[];
  ordersNeedingSchedule?: PendingScheduleRow[];
  approachingSchedules?: ApproachingScheduleRow[];
}) {
  const items: AttentionItem[] = [
    ...pendingCounters.map((row) => ({
      key: `counter-${row.availabilityOfferId}`,
      title: `Price response needed · ${row.productName}`,
      detail: `Company counter ${row.companyCounterPrice} ${row.currencyCode}${
        row.originalSupplierPrice
          ? ` · your price was ${row.originalSupplierPrice} ${row.currencyCode}`
          : ""
      }`,
      badge: "Counter offer",
      badgeTone: "urgent" as const,
      href: row.href,
      cta: "Accept / Revise",
      primary: true,
    })),
    ...pendingAvailability.map((row) => ({
      key: `req-${row.id}`,
      title: `Availability request · ${row.brandName}`,
      detail: `${row.itemCount} item${row.itemCount === 1 ? "" : "s"} · deadline ${row.responseDeadlineLabel}`,
      badge: row.status === "NEW" ? "New" : "Partial response",
      href: row.href,
      cta: "Respond",
      primary: true,
    })),
    ...pendingOrdersToConfirm.map((row) => ({
      key: `po-${row.id}`,
      title: `Confirm purchase order · ${row.orderNumber}`,
      detail: `${row.itemCount} item${row.itemCount === 1 ? "" : "s"} · expected ${row.expectedDeliveryLabel}`,
      badge: "Awaiting confirmation",
      badgeTone: "urgent" as const,
      href: row.href,
      cta: "Review & Confirm",
      primary: true,
    })),
    ...ordersNeedingSchedule.map((row) => ({
      key: `sched-${row.id}`,
      title: `Schedule delivery · ${row.orderNumber}`,
      detail: `${row.remainingDeliverable} remaining to schedule · expected ${row.expectedDeliveryLabel}`,
      badge: "Needs schedule",
      href: row.href,
      cta: "Schedule Delivery",
      primary: true,
    })),
    ...approachingSchedules.map((row) => ({
      key: `approach-${row.deliveryId}`,
      title: `${row.isOverdue ? "Planned delivery overdue" : "Upcoming planned delivery"} · ${row.orderNumber}`,
      detail: `Planned ${row.plannedDeliveryLabel}`,
      badge: row.isOverdue ? "Overdue" : "Approaching",
      badgeTone: row.isOverdue ? ("urgent" as const) : ("default" as const),
      href: row.href,
      cta: "View Schedule",
    })),
  ];

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Nothing needs your attention right now.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Needs your attention">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn(
            "rounded-lg border p-4",
            item.badgeTone === "urgent"
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-card",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex flex-col gap-1">
              <p className="font-medium leading-snug">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
              {item.badge ? (
                <Badge variant="outline" className="mt-1 w-fit">
                  {item.badge}
                </Badge>
              ) : null}
            </div>
            <Link
              href={item.href}
              className={cn(
                buttonVariants({
                  variant: item.primary ? "default" : "outline",
                  className: "min-h-11 w-full shrink-0 sm:w-auto",
                }),
              )}
            >
              {item.cta}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
