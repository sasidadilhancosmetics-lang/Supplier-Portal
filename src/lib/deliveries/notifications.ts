import "server-only";

import { Prisma } from "@/generated/prisma/client";

/** Company ADMIN + VERIFY_DELIVERY STAFF (deduped). */
export async function resolveCompanyDeliveryNotificationRecipients(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<string[]> {
  const [admins, verifyStaff] = await Promise.all([
    tx.user.findMany({
      where: {
        companyId,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    }),
    tx.user.findMany({
      where: {
        companyId,
        role: "STAFF",
        isActive: true,
        staffPermissions: { some: { code: "VERIFY_DELIVERY" } },
      },
      select: { id: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const u of admins) ids.add(u.id);
  for (const u of verifyStaff) ids.add(u.id);
  return [...ids];
}

export async function resolveSupplierUsers(
  tx: Prisma.TransactionClient,
  args: { companyId: string; supplierId: string },
): Promise<string[]> {
  const users = await tx.user.findMany({
    where: {
      companyId: args.companyId,
      supplierId: args.supplierId,
      role: "SUPPLIER",
      isActive: true,
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
