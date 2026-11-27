import { loadProtectedPage } from "@/lib/auth/page";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listSupplierDeliverableOrders } from "@/lib/deliveries/queries";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Deliveries" };

type DeliveryRow = Awaited<
  ReturnType<typeof listSupplierDeliverableOrders>
>[number];

export default async function SupplierDeliveriesPage() {
  const rows = await loadProtectedPage(() => listSupplierDeliverableOrders());
  const actionNeeded = rows.filter((r) => Number(r.remainingDeliverable) > 0);
  const upcoming = rows.filter((r) => r.scheduledCount > 0);
  const overdueAction = actionNeeded.filter((r) => r.isOverdue);
  const hasWork = actionNeeded.length > 0 || upcoming.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-1.5 sm:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Deliveries
        </h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Plan your upcoming deliveries here. The company records receipt when
          goods arrive.
        </p>
      </div>

      {!hasWork ? (
        <div
          className="rounded-lg border border-border px-4 py-8 text-center"
          role="status"
        >
          <p className="text-lg font-medium">You&apos;re all caught up!</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No deliveries need your attention right now.
          </p>
          <Link
            href="/supplier/orders"
            className={cn(
              buttonVariants({
                variant: "outline",
                className: "mt-4 min-h-11",
              }),
            )}
          >
            View Orders
          </Link>
        </div>
      ) : (
        <>
          {actionNeeded.length > 0 ? (
            <DeliveryGroup
              title="Action Needed"
              hint="Quantities still available to schedule."
              rows={actionNeeded}
              preferSchedule
              emphasizeOverdue
            />
          ) : null}

          {upcoming.length > 0 ? (
            <DeliveryGroup
              title="Upcoming Deliveries"
              hint="Active delivery plans."
              rows={upcoming}
              preferSchedule={false}
            />
          ) : null}

          {overdueAction.length > 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {overdueAction.length} overdue order
              {overdueAction.length === 1 ? "" : "s"} need scheduling attention
              above.
            </p>
          ) : null}

          <section className="flex flex-col gap-2 border-t border-border pt-6">
            <h2 className="text-base font-medium text-muted-foreground">
              Delivery History
            </h2>
            <p className="text-sm text-muted-foreground">
              Verified receipts and completed orders stay on each order page.
            </p>
            <Link
              href="/supplier/orders?status=DELIVERED"
              className={cn(
                buttonVariants({
                  variant: "outline",
                  className: "min-h-11 w-full sm:w-fit",
                }),
              )}
            >
              View delivered orders
            </Link>
          </section>
        </>
      )}
    </div>
  );
}

function DeliveryGroup({
  title,
  hint,
  rows,
  preferSchedule,
  emphasizeOverdue = false,
}: {
  title: string;
  hint: string;
  rows: DeliveryRow[];
  preferSchedule: boolean;
  emphasizeOverdue?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={`${title}-${row.id}`}
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
              emphasizeOverdue && row.isOverdue
                ? "border-primary/40 bg-primary/5"
                : "border-border",
            )}
          >
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{row.orderNumber}</p>
                {row.isOverdue ? <Badge variant="outline">Overdue</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {Number(row.remainingDeliverable) > 0
                  ? `${row.remainingDeliverable} left to schedule`
                  : "Fully scheduled"}
                {row.expectedDeliveryLabel
                  ? ` · Expected ${row.expectedDeliveryLabel}`
                  : ""}
                {row.scheduledCount > 0
                  ? ` · ${row.scheduledCount} planned`
                  : ""}
                {row.pendingVerificationCount > 0
                  ? ` · ${row.pendingVerificationCount} awaiting company receipt`
                  : ""}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link
                href={row.hrefOrder}
                className={cn(
                  buttonVariants({
                    variant: "outline",
                    className: "min-h-11 w-full sm:w-auto",
                  }),
                )}
              >
                View order
              </Link>
              <Link
                href={row.hrefDeliver}
                className={cn(
                  buttonVariants({
                    variant:
                      preferSchedule && Number(row.remainingDeliverable) > 0
                        ? "default"
                        : "outline",
                    className: "min-h-11 w-full sm:w-auto",
                  }),
                )}
              >
                {Number(row.remainingDeliverable) > 0
                  ? "Schedule Delivery"
                  : "View Schedule"}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
