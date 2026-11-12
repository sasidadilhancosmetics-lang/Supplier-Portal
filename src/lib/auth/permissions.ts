import "server-only";

import type { StaffPermissionCode } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

/**
 * Load StaffPermission codes for a user from Postgres.
 * Empty set means deny-by-default for staff permission checks.
 */
export async function loadStaffPermissionCodes(
  userId: string,
): Promise<Set<StaffPermissionCode>> {
  const rows = await prisma.staffPermission.findMany({
    where: { userId },
    select: { code: true },
  });

  return new Set(rows.map((row) => row.code));
}
