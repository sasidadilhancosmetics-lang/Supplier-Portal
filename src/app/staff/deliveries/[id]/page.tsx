import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { approveDeliveryScheduleAction } from "@/app/staff/deliveries/actions";
import { VerifyDeliveryForm } from "@/components/staff/verify-delivery-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { isAuthorizationError } from "@/lib/auth/errors";
import { isDeliveryDomainError } from "@/lib/deliveries/errors";
import { getDeliveryForStaffVerification } from "@/lib/deliveries/queries";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Record receipt" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ approvalError?: string }>;
};

export default async function StaffVerifyDeliveryPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { approvalError } = await searchParams;
  let delivery;
  try {
    delivery = await getDeliveryForStaffVerification(id);
  } catch (error) {
    if (
      (isDeliveryDomainError(error) && error.code === "NOT_FOUND") ||
      (isAuthorizationError(error) && error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {delivery.needsScheduleApproval ? "Review proposed schedule" : delivery.isScheduled ? "Record receipt" : "Verify delivery"}
            </h1>
            <Badge variant="outline">{delivery.statusLabel}</Badge>
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            {delivery.supplierName} · {delivery.orderNumber}.{" "}
            {delivery.needsScheduleApproval
              ? "Review the proposed date and quantities before approving."
              : "Enter what physically arrived. Planned/submitted amounts are reference only."}
          </p>
          <p className="text-sm text-muted-foreground">
            {delivery.plannedDeliveryAtLabel
              ? `Planned ${delivery.plannedDeliveryAtLabel}`
              : `Submitted delivery ${delivery.deliveredAtLabel || "—"}`}{" "}
            · Created {delivery.submittedAtLabel}
            {delivery.receivedAtLabel
              ? ` · Received ${delivery.receivedAtLabel}`
              : ""}
            {delivery.verifiedAtLabel
              ? ` · Reviewed ${delivery.verifiedAtLabel}`
              : ""}
            {delivery.verifiedByEmail ? ` by ${delivery.verifiedByEmail}` : ""}
            {delivery.grnNumber ? ` · GRN ${delivery.grnNumber}` : ""}
          </p>
          {delivery.notes ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Notes: {delivery.notes}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/staff/deliveries"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            All deliveries
          </Link>
          <Link
            href={`/staff/orders/${delivery.purchaseOrderId}`}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Purchase order
          </Link>
        </div>
      </div>

      {approvalError ? <p role="alert" className="text-destructive">{approvalError}</p> : null}
      {delivery.needsScheduleApproval ? (
        <form action={approveDeliveryScheduleAction.bind(null, delivery.id)} className="space-y-4">
          <ul className="space-y-2">
            {delivery.lines.map((line) => (
              <li key={line.deliveryItemId}>
                {line.productName} ({line.productSku}) · {line.quantitySubmitted} {line.unitOfMeasure}
              </li>
            ))}
          </ul>
          <Button type="submit" className="min-h-11">Approve delivery schedule</Button>
        </form>
      ) : delivery.canVerify ? (
        <VerifyDeliveryForm
          deliveryId={delivery.id}
          requiresReceivedAt={delivery.requiresReceivedAt}
          plannedLabel={
            delivery.isScheduled ? "Supplier scheduled" : "Supplier submitted"
          }
          lines={delivery.lines}
        />
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          This delivery is no longer awaiting receipt verification.
        </p>
      )}
    </div>
  );
}
