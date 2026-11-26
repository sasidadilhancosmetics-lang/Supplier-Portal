import "server-only";

import { writeAuditLog } from "@/lib/audit";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { DeliveryDomainError } from "./errors";
import { lockDeliveryForUpdate, lockPurchaseOrderForUpdate } from "./locks";

export async function approveDeliverySchedule(deliveryId: string) {
  const user = await requireStaffPermission("VERIFY_DELIVERY");
  return prisma.$transaction(async (tx) => {
    const scope = { id: deliveryId, companyId: user.companyId };
    const delivery = await tx.delivery.findFirst({
      where: scope,
      select: { purchaseOrderId: true },
    });
    if (!delivery) {
      throw new DeliveryDomainError("NOT_FOUND", "Delivery not found.");
    }

    // Match receipt verification and rescheduling: purchase order, then delivery.
    await lockPurchaseOrderForUpdate(tx, delivery.purchaseOrderId);
    await lockDeliveryForUpdate(tx, deliveryId);
    const approvedAt = new Date();
    const updated = await tx.delivery.updateMany({
      where: {
        ...scope,
        status: "SCHEDULED",
        plannedDeliveryAt: { not: null },
        scheduleApprovedAt: null,
        purchaseOrder: { requiresScheduleApproval: true },
      },
      data: { scheduleApprovedAt: approvedAt },
    });
    if (!updated.count) {
      throw new DeliveryDomainError("INVALID_STATUS", "This delivery is no longer awaiting schedule approval.");
    }
    await writeAuditLog({
      tx,
      actorUserId: user.id,
      entityType: "Delivery",
      entityId: deliveryId,
      action: "DELIVERY_SCHEDULE_APPROVED",
      afterJson: { purchaseOrderId: delivery.purchaseOrderId, approvedAt: approvedAt.toISOString() },
    });
    return { deliveryId, purchaseOrderId: delivery.purchaseOrderId };
  });
}
