import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderItemsPricingTable } from "@/components/orders/order-items-pricing-table";
import { CancelOrderForm } from "@/components/supplier/cancel-order-form";
import { ConfirmOrderForm } from "@/components/supplier/confirm-order-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { loadSubmittedDeliveryHolds } from "@/lib/deliveries/holds";
import { prisma } from "@/lib/db";
import { OrderDomainError } from "@/lib/orders/errors";
import { getPurchaseOrderForSupplier } from "@/lib/orders/queries";
import { buildSupplierOrderQuantitySummary } from "@/lib/orders/supplier-order-summary";
import {
  canSupplierCancelOrder,
  supplierPurchaseOrderStatusLabel,
} from "@/lib/orders/status-labels";
import { resolveSupplierOrderNextAction } from "@/lib/supplier/order-next-action";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Order detail" };

type PageProps = { params: Promise<{ id: string }> };

export default async function SupplierOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  let po;
  try {
    po = await getPurchaseOrderForSupplier(id);
  } catch (error) {
    if (error instanceof OrderDomainError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const orderNumber = po.orderNumber ?? po.id;
  const canConfirm = po.status === "SENT";
  const canCancel = canSupplierCancelOrder(po.status);
  const canDeliver =
    po.status === "CONFIRMED" ||
    po.status === "PARTIALLY_DELIVERED" ||
    po.status === "PARTIALLY_CANCELLED";
  const isCancelled =
    po.status === "CANCELLED" || po.status === "PARTIALLY_CANCELLED";

  const holds = await loadSubmittedDeliveryHolds(
    prisma as never,
    po.items.map((item) => item.id),
  );
  const summary = buildSupplierOrderQuantitySummary({
    items: po.items.map((item) => ({
      orderItemId: item.id,
      quantityOrdered: item.quantityOrdered,
      quantityCancelled: item.quantityCancelled,
      quantityVerifiedReceived: item.quantityVerifiedReceived,
      unitPrice: item.unitPrice,
    })),
    currencyCode: po.currencyCode,
    holdsByOrderItemId: holds,
  });

  const canSchedule =
    canDeliver && Number(summary.availableToSchedule) > 0;
  const hasActiveSchedule = await prisma.delivery.count({
    where: {
      purchaseOrderId: po.id,
      status: { in: ["SUBMITTED", "SCHEDULED"] },
    },
  });
  const nextAction = resolveSupplierOrderNextAction({
    id: po.id,
    status: po.status,
    canSchedule,
    hasActiveSchedule: hasActiveSchedule > 0,
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {orderNumber}
            </h1>
            <Badge variant="outline">
              {supplierPurchaseOrderStatusLabel(po.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatDateTime(po.createdAt)}
            {po.confirmedAt
              ? ` · Confirmed ${formatDateTime(po.confirmedAt)}`
              : ""}
            {po.cancelledAt
              ? ` · Cancelled ${formatDateTime(po.cancelledAt)}`
              : ""}
          </p>
          {isCancelled && po.cancelReason ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Reason: {po.cancelReason}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {po.status !== "DELIVERED" &&
          po.status !== "CANCELLED" &&
          nextAction.href.includes("/deliver") ? (
            <Link
              href={nextAction.href}
              className={cn(
                buttonVariants({ className: "min-h-11 w-full sm:w-auto" }),
              )}
            >
              {nextAction.label === "View Order"
                ? "Plan Delivery"
                : nextAction.label}
            </Link>
          ) : canDeliver ? (
            <Link
              href={`/supplier/orders/${po.id}/deliver`}
              className={cn(
                buttonVariants({ className: "min-h-11 w-full sm:w-auto" }),
              )}
            >
              Plan Delivery
            </Link>
          ) : null}
          <Link
            href="/supplier/orders"
            className={cn(
              buttonVariants({
                variant: "outline",
                className: "min-h-11 w-fit sm:w-auto",
              }),
            )}
          >
            Back
          </Link>
        </div>
      </div>

      <section
        className="rounded-lg border border-border p-4"
        aria-labelledby="order-summary-heading"
      >
        <h2 id="order-summary-heading" className="text-lg font-medium">
          Order summary
        </h2>
        {summary.isFullyDelivered || po.status === "DELIVERED" ? (
          <p className="mt-3 text-base font-medium" role="status">
            Delivered: {summary.receivedQty} of {summary.orderedQty} units
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Ordered</dt>
              <dd className="font-medium tabular-nums">{summary.orderedQty}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Received</dt>
              <dd className="font-medium tabular-nums">{summary.receivedQty}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Left to receive</dt>
              <dd className="font-medium tabular-nums">
                {summary.remainingToReceive}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Left to schedule</dt>
              <dd className="font-medium tabular-nums">
                {summary.availableToSchedule}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          Order value:{" "}
          <span className="font-medium text-foreground">
            {summary.hasRecordedPrice
              ? summary.orderValueLabel
              : "Price not recorded on this order"}
          </span>
        </p>
        {!summary.hasRecordedPrice ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Legacy orders may have no snapshotted unit price.
          </p>
        ) : null}
        {Number(summary.remainingToReceive) > 0 &&
        Number(summary.availableToSchedule) <
          Number(summary.remainingToReceive) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Left to schedule is lower than left to receive because active
            delivery plans already hold some quantity.
          </p>
        ) : null}
      </section>

      <OrderItemsPricingTable
        items={po.items}
        currencyCode={po.currencyCode}
      />

      {(canConfirm || canCancel) && !isCancelled ? (
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          {canConfirm ? (
            <ConfirmOrderForm
              purchaseOrderId={po.id}
              orderNumber={orderNumber}
            />
          ) : null}
          {canCancel ? (
            <CancelOrderForm
              purchaseOrderId={po.id}
              orderNumber={orderNumber}
            />
          ) : null}
        </div>
      ) : null}

      {isCancelled ? (
        <p className="text-sm text-muted-foreground">
          This order has been cancelled. No further confirmation or cancellation
          is available.
        </p>
      ) : null}
    </div>
  );
}
