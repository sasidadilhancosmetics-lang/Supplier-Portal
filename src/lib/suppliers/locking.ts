import "server-only";

import { Prisma } from "@/generated/prisma/client";

/** Requirement locks, where used, precede these locks. Supplier-only writers never lock requirements. */
export async function lockSuppliers(
  tx: Prisma.TransactionClient,
  companyId: string,
  supplierIds: readonly string[],
) {
  const ids = [...new Set(supplierIds)];
  if (!ids.length) return [];
  return tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Supplier"
    WHERE "companyId" = ${companyId} AND id IN (${Prisma.join(ids)})
    ORDER BY id FOR UPDATE
  `;
}
