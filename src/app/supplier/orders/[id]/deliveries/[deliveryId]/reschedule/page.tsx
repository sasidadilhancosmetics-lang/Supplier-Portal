import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RescheduleDeliveryForm } from "@/components/supplier/reschedule-delivery-form";
import { buttonVariants } from "@/components/ui/button";
import { requireSupplier } from "@/lib/auth/guards";
import { remainingDeliverable } from "@/lib/deliveries/delivery-math";
import { DeliveryDomainError, isDeliveryDomainError } from "@/lib/deliveries/errors";
import { loadSubmittedDeliveryHolds } from "@/lib/deliveries/holds";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Reschedule delivery" };

type PageProps = {
  params: Promise<{ id: string; deliveryId: string }>;
};

export default async function SupplierRescheduleDeliveryPage({
  params,
}: PageProps) {
  const { id, deliveryId } = await params;
  const user = await requireSupplier();

  try {
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        purchaseOrderId: id,
        supplierId: user.supplierId!,
        companyId: user.companyId,
        status: "SCHEDULED",
      },
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true } },
        items: {
          include: {
            orderItem: {
              include: {
                product: { select: { name: true, sku: true } },
              },
            },
          },
        },
      },
    });
    if (!delivery) {
      throw new DeliveryDomainError("NOT_FOUND", "Scheduled delivery not found.");
    }

    const orderItemIds = delivery.items.map((i) => i.orderItemId);
    const holds = await loadSubmittedDeliveryHolds(prisma as never, orderItemIds);
    // Prior SCHEDULED still holds; remaining shown includes that hold. Reschedule
    // frees it in the transaction before applying the new plan.
    const lines = delivery.items.map((item) => {
      const oi = item.orderItem;
      const remaining = remainingDeliverable({
        quantityOrdered: oi.quantityOrdered,
        quantityCancelled: oi.quantityCancelled,
        quantityVerifiedReceived: oi.quantityVerifiedReceived,
        submittedHold: holds.get(oi.id) ?? 0,
      }).plus(item.quantityDelivered);
      return {
        orderItemId: oi.id,
        productName: oi.product.name,
        productSku: oi.product.sku,
        quantityPlanned: item.quantityDelivered.toString(),
        remainingDeliverable: remaining.toString(),
      };
    });

    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Reschedule delivery
            </h1>
            <p className="text-base leading-7 text-muted-foreground">
              Update the plan for{" "}
              {delivery.purchaseOrder.orderNumber ?? delivery.purchaseOrder.id}.
            </p>
          </div>
          <Link
            href={`/supplier/orders/${id}/deliver`}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Back
          </Link>
        </div>
        <RescheduleDeliveryForm
          deliveryId={delivery.id}
          orderNumber={
            delivery.purchaseOrder.orderNumber ?? delivery.purchaseOrder.id
          }
          lines={lines}
        />
      </div>
    );
  } catch (error) {
    if (isDeliveryDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }
}
