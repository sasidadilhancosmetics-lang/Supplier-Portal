import "server-only";

import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { loadRequirementCoverage } from "@/lib/orders/coverage";

import { loadCompanyPriceActionItems } from "./price-actions";
import {
  buildSupplierResponseSummary,
  offerNeedsPriceReview,
  offerReadyForAllocation,
  type SupplierResponseSummary,
} from "./supplier-responses-logic";

export type { SupplierResponseSummary };
export type { PriceActionItem } from "./price-actions";
export type SupplierResponseRow = {
  id: string;
  supplierName: string;
  brandName: string;
  requirementTitle: string | null;
  status: string;
  respondedAt: Date | null;
  respondedAtLabel: string;
  href: string;
};

/** Company-scoped supplier response summary + recent rows. */
export async function loadSupplierResponseDashboard(companyId: string) {
  const now = new Date();

  const [awaitingResponses, responsesReceived, offers] = await Promise.all([
    prisma.supplierRequest.count({
      where: {
        companyId,
        status: { in: ["NEW", "PARTIALLY_RESPONDED"] },
      },
    }),
    prisma.supplierRequest.count({
      where: { companyId, status: "RESPONDED" },
    }),
    prisma.availabilityOffer.findMany({
      where: {
        status: "SUBMITTED",
        requestItem: { companyId },
      },
      select: {
        status: true,
        unitPrice: true,
        quantityDeclared: true,
        quantityOrderedActive: true,
        reserveExpiresAt: true,
        requestItem: {
          select: {
            supplierRequestId: true,
            requirementItemId: true,
          },
        },
        priceAgreement: { select: { status: true } },
      },
    }),
  ]);

  const requirementIds = [
    ...new Set(
      offers
        .map((o) => o.requestItem.requirementItemId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const coverage = await loadRequirementCoverage(
    prisma as never,
    requirementIds,
  );

  const needingIds: string[] = [];
  const readyIds: string[] = [];
  for (const offer of offers) {
    const requestId = offer.requestItem.supplierRequestId;
    if (
      offerNeedsPriceReview({
        status: offer.status,
        unitPrice: offer.unitPrice,
        agreementStatus: offer.priceAgreement?.status,
      })
    ) {
      needingIds.push(requestId);
    }
    const reqId = offer.requestItem.requirementItemId;
    const remainingPlan = reqId
      ? (coverage.get(reqId)?.remainingPlan ?? 0)
      : 0;
    if (
      offerReadyForAllocation({
        status: offer.status,
        reserveExpiresAt: offer.reserveExpiresAt,
        quantityDeclared: offer.quantityDeclared,
        quantityOrderedActive: offer.quantityOrderedActive,
        agreementStatus: offer.priceAgreement?.status,
        remainingPlanQuantity: remainingPlan,
        now,
      })
    ) {
      readyIds.push(requestId);
    }
  }

  const summary = buildSupplierResponseSummary({
    awaitingResponses,
    responsesReceived,
    needingRequestIds: needingIds,
    readyRequestIds: readyIds,
  });

  const recent = await prisma.supplierRequest.findMany({
    where: {
      companyId,
      status: { in: ["RESPONDED", "PARTIALLY_RESPONDED"] },
      respondedAt: { not: null },
    },
    orderBy: { respondedAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      respondedAt: true,
      supplier: { select: { name: true } },
      brand: { select: { name: true } },
      requirement: { select: { title: true } },
    },
  });

  const recentResponses: SupplierResponseRow[] = recent.map((row) => ({
    id: row.id,
    supplierName: row.supplier.name,
    brandName: row.brand.name,
    requirementTitle: row.requirement?.title ?? null,
    status: row.status,
    respondedAt: row.respondedAt,
    respondedAtLabel: formatDateTime(row.respondedAt),
    href: `/staff/requests/${row.id}`,
  }));

  const priceActions = await loadCompanyPriceActionItems(companyId);

  return { summary, recentResponses, priceActions };
}
