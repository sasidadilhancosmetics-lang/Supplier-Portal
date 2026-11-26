import "server-only";

import { Prisma } from "@/generated/prisma/client";

/**
 * Take the company lock before any requirement or supplier lock.
 * Distribution keeps its existing requirement → supplier order and never
 * takes this lock. Both modes allow foreign-key checks on the company row.
 */
export async function lockCompanyCatalogue(
  tx: Prisma.TransactionClient,
  companyId: string,
  operation: "receive-import" | "confirm-import" | "save-price",
): Promise<boolean> {
  const lock = operation === "save-price" ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR NO KEY UPDATE`;
  const companies = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Company" WHERE id = ${companyId} ${lock}
  `;
  return companies.length > 0;
}
