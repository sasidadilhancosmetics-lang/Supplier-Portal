import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ScheduleDeliveryForm } from "@/components/supplier/schedule-delivery-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isDeliveryDomainError } from "@/lib/deliveries/errors";
import { getSupplierOrderForDelivery } from "@/lib/deliveries/queries";
import { supplierOrderDeliveryLabel } from "@/lib/deliveries/status-labels";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Plan Your Delivery" };

type PageProps = { params: Promise<{ id: string }> };

export default async function SupplierScheduleDeliveryPage({
  params,
}: PageProps) {
  const { id } = await params;
  let order;
  try {
    order = await getSupplierOrderForDelivery(id);
  } catch (error) {
    if (isDeliveryDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const upcoming = order.deliveries.filter(
    (d) => d.status === "SCHEDULED" || d.status === "SUBMITTED",
  );
  const history = order.deliveries.filter(
    (d) => d.status !== "SCHEDULED" && d.status !== "SUBMITTED",
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Plan Your Delivery
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            {order.orderNumber} ·{" "}
            <span className="font-medium text-foreground">
              {supplierOrderDeliveryLabel(order.status)}
            </span>
            . {order.requiresScheduleApproval
              ? "Company staff approve your proposed schedule and record physical receipt."
              : "Company staff record physical receipt."}
          </p>
        </div>
        <Link
          href={`/supplier/orders/${order.id}`}
          className={cn(
            buttonVariants({
              variant: "outline",
              className: "min-h-11 w-full sm:w-auto",
            }),
          )}
        >
          Back to order
        </Link>
      </div>

      {!order.canSubmitDelivery ? (
        <p className="text-sm text-muted-foreground" role="status">
          No remaining quantity is available to schedule right now. Active
          schedules still count against remaining capacity.
        </p>
      ) : (
        <ScheduleDeliveryForm
          purchaseOrderId={order.id}
          orderNumber={order.orderNumber}
          lines={order.lines}
        />
      )}

      {upcoming.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Upcoming schedules</h2>
          <ul className="flex flex-col gap-3">
            {upcoming.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{d.statusLabel}</Badge>
                    {d.plannedDeliveryAtLabel ? (
                      <span className="font-medium">
                        Planned {d.plannedDeliveryAtLabel}
                      </span>
                    ) : null}
                  </div>
                  {d.notes ? (
                    <p className="mt-1 text-muted-foreground">{d.notes}</p>
                  ) : null}
                </div>
                {d.canReschedule ? (
                  <Link
                    href={d.rescheduleHref}
                    className={cn(
                      buttonVariants({
                        variant: "outline",
                        className: "min-h-11 w-full shrink-0 sm:w-auto",
                      }),
                    )}
                  >
                    Reschedule
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Receipt history</h2>
          <ul className="flex flex-col gap-3">
            {history.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{d.statusLabel}</Badge>
                  {d.receivedAtLabel ? (
                    <span>Received {d.receivedAtLabel}</span>
                  ) : null}
                  {d.grnNumber ? (
                    <span className="text-muted-foreground">
                      GRN {d.grnNumber}
                    </span>
                  ) : null}
                </div>
                {d.rescheduleReason ? (
                  <p className="mt-1 text-muted-foreground">
                    Reschedule reason: {d.rescheduleReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
