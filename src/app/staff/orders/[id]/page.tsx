import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderItemsPricingTable } from "@/components/orders/order-items-pricing-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { OrderDomainError } from "@/lib/orders/errors";
import { getPurchaseOrderForStaff } from "@/lib/orders/queries";
import { staffPurchaseOrderStatusLabel } from "@/lib/orders/status-labels";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Purchase order" };

type PageProps = { params: Promise<{ id: string }> };

export default async function PurchaseOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  let po;
  try {
    po = await getPurchaseOrderForStaff(id);
  } catch (error) {
    if (error instanceof OrderDomainError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const isCancelled =
    po.status === "CANCELLED" || po.status === "PARTIALLY_CANCELLED";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {po.orderNumber ?? po.id}
            </h1>
            <Badge variant="outline">
              {staffPurchaseOrderStatusLabel(po.status)}
            </Badge>
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Supplier {po.supplier.name}. Only the supplier can cancel this
            order.
          </p>
          <p className="text-sm text-muted-foreground">
            Created {formatDateTime(po.createdAt)}
            {po.status === "SENT"
              ? " · Awaiting supplier confirmation"
              : ""}
            {po.confirmedAt
              ? ` · Confirmed ${formatDateTime(po.confirmedAt)}`
              : ""}
            {po.cancelledAt
              ? ` · Cancelled ${formatDateTime(po.cancelledAt)}`
              : ""}
          </p>
          {isCancelled && po.cancelReason ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Cancellation reason: {po.cancelReason}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/staff/orders"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Orders
          </Link>
          <Link
            href="/staff/requests"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Requests
          </Link>
        </div>
      </div>

      {po.coverage.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-lg font-medium">Requirement coverage</h2>
          <p className="text-sm text-muted-foreground">
            Uncovered quantity is recomputed from planned minus net ordered
            after cancellations.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Planned</th>
                  <th className="px-3 py-2 font-medium">Net ordered</th>
                  <th className="px-3 py-2 font-medium">Uncovered</th>
                </tr>
              </thead>
              <tbody>
                {po.coverage.map((row) => (
                  <tr key={row.requirementItemId} className="border-b last:border-0">
                    <td className="px-3 py-2">{row.productName ?? "—"}</td>
                    <td className="px-3 py-2">{row.quantityPlanned}</td>
                    <td className="px-3 py-2">{row.netOrdered}</td>
                    <td className="px-3 py-2">{row.uncovered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {po.reRequestRequirements.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Re-request uncovered demand manually. Sending a new supplier
                request always requires explicit confirmation on the distribute
                page.
              </p>
              <div className="flex flex-wrap gap-2">
                {po.reRequestRequirements.map((req) => (
                  <Link
                    key={req.requirementId}
                    href={`/staff/requirements/${req.requirementId}/distribute`}
                    className={cn(buttonVariants({ className: "min-h-11" }))}
                  >
                    Re-request uncovered
                    {req.title ? `: ${req.title}` : ""}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <OrderItemsPricingTable
        items={po.items}
        currencyCode={po.currencyCode}
        showReserve
        showLineStatus
      />
    </div>
  );
}
