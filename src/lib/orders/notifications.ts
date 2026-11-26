import "server-only";

import { Prisma } from "@/generated/prisma/client";

/**
 * Company ADMIN + ALLOCATE_ORDER STAFF + allocate/create actor (deduped).
 */
export async function resolveCompanyOrderNotificationRecipients(
  tx: Prisma.TransactionClient,
  args: { companyId: string; purchaseOrderId: string },
): Promise<string[]> {
  const [admins, allocateStaff, createAudit] = await Promise.all([
    tx.user.findMany({
      where: {
        companyId: args.companyId,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    }),
    tx.user.findMany({
      where: {
        companyId: args.companyId,
        role: "STAFF",
        isActive: true,
        staffPermissions: { some: { code: "ALLOCATE_ORDER" } },
      },
      select: { id: true },
    }),
    tx.auditLog.findFirst({
      where: {
        entityType: "PurchaseOrder",
        entityId: args.purchaseOrderId,
        action: "CREATE",
      },
      orderBy: { createdAt: "asc" },
      select: { actorUserId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const u of admins) ids.add(u.id);
  for (const u of allocateStaff) ids.add(u.id);
  if (createAudit?.actorUserId) {
    const creator = await tx.user.findFirst({
      where: {
        id: createAudit.actorUserId,
        companyId: args.companyId,
        isActive: true,
        role: { in: ["ADMIN", "STAFF"] },
      },
      select: { id: true },
    });
    if (creator) ids.add(creator.id);
  }
  return [...ids];
}
