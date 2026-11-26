import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { isOrderDomainError } from "@/lib/orders/errors";
import { listPurchaseOrdersForStaff } from "@/lib/orders/queries";
import { staffPurchaseOrderStatusLabel } from "@/lib/orders/status-labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Purchase orders",
  description: "Company view of allocated purchase orders.",
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
    result = await listPurchaseOrdersForStaff(params);
  } catch (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {isOrderDomainError(error) ? error.message : "Unable to load orders."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            name="status"
            defaultValue={result.status ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="AWAITING_CONFIRMATION">
              Awaiting confirmation
            </option>
            <option value="SENT">Sent</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="PARTIALLY_CANCELLED">Partially cancelled</option>
          </select>
        </label>
        <button
          type="submit"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Apply
        </button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No purchase orders yet. Allocate from a supplier request to create
          one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Order</th>
                <th className="px-3 py-3 font-medium">Supplier</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Items</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Confirmed</th>
                <th className="px-3 py-3 font-medium">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <Link
                      href={`/staff/orders/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.orderNumber ?? row.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.supplier.name}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="outline">
                      {staffPurchaseOrderStatusLabel(row.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">{row._count.items}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(row.confirmedAt)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(row.cancelledAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function StaffOrdersPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Purchase orders
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Track allocated orders and supplier confirmation. Staff cannot confirm
          on behalf of suppliers.
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
