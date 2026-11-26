import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  listCompanyDeliveryOverview,
  listPendingDeliveriesForStaff,
} from "@/lib/deliveries/queries";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Scheduled deliveries" };

export default async function StaffDeliveriesPage() {
  const [pending, overview] = await Promise.all([
    listPendingDeliveriesForStaff(),
    listCompanyDeliveryOverview(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Scheduled deliveries
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Upcoming and overdue schedules, plus legacy submissions awaiting
          receipt. Record what physically arrived — scheduling alone is not
          stock received.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Upcoming / pending receipt"
          value={overview.pendingVerification}
        />
        <Stat label="Overdue open orders" value={overview.overdue} />
        <Stat label="Partial deliveries" value={overview.partial} />
        <Stat label="Recent discrepancies" value={overview.rejectedRecent} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Upcoming / overdue</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No scheduled deliveries are waiting for receipt verification.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">
                    {row.supplierName} · {row.orderNumber}
                    {row.isOverdue ? " · Overdue" : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.statusLabel}
                    {row.plannedDeliveryAtLabel
                      ? ` · Planned ${row.plannedDeliveryAtLabel}`
                      : row.deliveredAtLabel
                        ? ` · Delivered ${row.deliveredAtLabel}`
                        : ""}{" "}
                    · {row.totalSubmitted} units · {row.itemCount} line
                    {row.itemCount === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-1 text-sm text-muted-foreground">
                    {row.lines.map((line, index) => (
                      <li key={`${row.id}-${index}`}>
                        {line.productName}
                        {line.productSku ? ` (${line.productSku})` : ""} ·{" "}
                        {line.quantityDelivered}
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={row.href}
                  className={cn(
                    buttonVariants({ className: "min-h-11 shrink-0" }),
                  )}
                >
                  {row.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
