import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isOrderDomainError } from "@/lib/orders/errors";
import { listPurchaseOrdersForSupplier } from "@/lib/orders/queries";
import { supplierPurchaseOrderStatusLabel } from "@/lib/orders/status-labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders",
  description: "Purchase orders for your supplier company.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>;
};

async function OrderList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  let result;
  try {
    result = await listPurchaseOrdersForSupplier(params);
  } catch (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {isOrderDomainError(error) ? error.message : "Unable to load orders."}
      </p>
    );
  }

  const showFilter = result.hasAnyOrders;

  return (
    <div className="flex flex-col gap-4">
      {showFilter ? (
        <form method="get" className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={result.status ?? ""}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm sm:flex-none"
          >
            <option value="">All</option>
            <option value="SENT">Awaiting confirmation</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PARTIALLY_DELIVERED">Partially delivered</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button
            type="submit"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Filter
          </button>
        </form>
      ) : null}

      {result.items.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-6" role="status">
          <p className="font-medium">
            {result.hasAnyOrders ? "No matching orders" : "No orders yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.hasAnyOrders
              ? "Try a different status filter to see more orders."
              : "New purchase orders will appear here."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/supplier/orders/${row.id}`}
                      className="text-base font-medium underline-offset-4 hover:underline"
                    >
                      {row.orderNumber ?? row.id}
                    </Link>
                    <Badge variant="outline">
                      {supplierPurchaseOrderStatusLabel(row.status)}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-3">
                    <div>
                      <dt className="sr-only">Items</dt>
                      <dd>
                        {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
                      </dd>
                    </div>
                    <div>
                      <dt className="sr-only">Expected delivery</dt>
                      <dd>Expected {row.expectedDeliveryLabel}</dd>
                    </div>
                  </dl>
                </div>
                <Link
                  href={row.nextAction.href}
                  className={cn(
                    buttonVariants({
                      variant:
                        row.nextAction.label === "View Details" ||
                        row.nextAction.label === "View Order" ||
                        row.nextAction.label === "View Delivery Schedule"
                          ? "outline"
                          : "default",
                      className: "min-h-11 w-full shrink-0 sm:w-auto",
                    }),
                  )}
                >
                  {row.nextAction.label}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SupplierOrdersPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Confirm purchase orders and schedule deliveries when quantity remains.
        </p>
      </div>
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <OrderList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
