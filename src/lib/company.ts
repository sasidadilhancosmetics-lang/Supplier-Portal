import "server-only";

import { prisma } from "@/lib/db";

/**
 * Phase 1: exactly one purchasing company.
 * Self-registration must never accept companyId from the client.
 */
export async function getPurchasingCompanyId(): Promise<string> {
  const companies = await prisma.company.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  if (companies.length === 0) {
    throw new Error("Purchasing company is not configured.");
  }
  if (companies.length > 1) {
    throw new Error(
      "Multiple purchasing companies found; Phase 1 expects exactly one.",
    );
  }

  return companies[0]!.id;
}
