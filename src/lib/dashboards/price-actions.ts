import "server-only";

import { formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { loadRequirementCoverage } from "@/lib/orders/coverage";

import { offerReadyForAllocation } from "./supplier-responses-logic";

export type PriceActionItem = {
  id: string;
  kind: "CONFIRMED_REVIEW" | "REVISED_REVIEW";
  supplierName: string;
  productName: string;
  unitPrice: string;
  currencyCode: string;
  availabilityStatus: string;
  agreementStatus: string;
  readyForAllocation: boolean;
  reserveLabel: string;
  hrefReview: string;
  hrefAllocate: string | null;
  updatedAtLabel: string;
};

/**
 * Company-scoped actionable price items for Admin/Staff dashboards.
 * Confirmed = supplier-accepted agreement still needed for uncovered plan.
 * Revised = supplier revised quote awaiting staff decision.
 * Fully covered plans / fully allocated / expired-reserve confirmed offers
 * are not ordinary allocation work (above-plan stays on the allocate page).
 */
export async function loadCompanyPriceActionItems(companyId: string) {
  const now = new Date();

  const offers = await prisma.availabilityOffer.findMany({
    where: {
      status: "SUBMITTED",
      requestItem: { companyId },
      priceAgreement: {
        status: {
          in: ["SUPPLIER_CONFIRMED", "STAFF_ATTESTED_AGREED", "QUOTED"],
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      status: true,
      unitPrice: true,
      currencyCode: true,
      quantityDeclared: true,
      quantityOrderedActive: true,
      reserveExpiresAt: true,
      updatedAt: true,
      supplier: { select: { name: true } },
      requestItem: {
        select: {
          supplierRequestId: true,
          requirementItemId: true,
          product: { select: { name: true } },
        },
      },
      priceAgreement: {
        select: {
          status: true,
          unitPrice: true,
          currencyCode: true,
          updatedAt: true,
          currentQuote: { select: { kind: true } },
        },
      },
    },
  });

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

  const confirmed: PriceActionItem[] = [];
  const revised: PriceActionItem[] = [];

  for (const offer of offers) {
    const agreement = offer.priceAgreement;
    if (!agreement) continue;

    const remainingOffer =
      Number(offer.quantityDeclared.toString()) -
      Number(offer.quantityOrderedActive.toString());
    const reqId = offer.requestItem.requirementItemId;
    const remainingPlan = reqId
      ? (coverage.get(reqId)?.remainingPlan ?? 0)
      : 0;
    const remainingPlanNum = Number(remainingPlan.toString());

    const ready = offerReadyForAllocation({
      status: offer.status,
      reserveExpiresAt: offer.reserveExpiresAt,
      quantityDeclared: offer.quantityDeclared,
      quantityOrderedActive: offer.quantityOrderedActive,
      agreementStatus: agreement.status,
      remainingPlanQuantity: remainingPlan,
      now,
    });

    const base = {
      id: offer.id,
      supplierName: offer.supplier.name,
      productName: offer.requestItem.product.name,
      unitPrice: agreement.unitPrice.toString(),
      currencyCode: agreement.currencyCode ?? offer.currencyCode ?? "LKR",
      availabilityStatus: offer.status,
      agreementStatus: agreement.status,
      readyForAllocation: ready,
      reserveLabel: offer.reserveExpiresAt
        ? offer.reserveExpiresAt.getTime() > now.getTime()
          ? `Reserve until ${formatDateTime(offer.reserveExpiresAt)}`
          : "Reserve expired"
        : "No active reserve",
      hrefReview: `/staff/offers/${offer.id}/negotiate`,
      hrefAllocate: ready
        ? `/staff/orders/allocate?requestId=${encodeURIComponent(offer.requestItem.supplierRequestId)}`
        : null,
      updatedAtLabel: formatDateTime(agreement.updatedAt),
    };

    if (
      (agreement.status === "SUPPLIER_CONFIRMED" ||
        agreement.status === "STAFF_ATTESTED_AGREED") &&
      remainingOffer > 0 &&
      remainingPlanNum > 0
    ) {
      confirmed.push({
        ...base,
        kind: "CONFIRMED_REVIEW",
      });
    } else if (
      agreement.status === "QUOTED" &&
      agreement.currentQuote.kind === "SUPPLIER_REVISED"
    ) {
      revised.push({
        ...base,
        kind: "REVISED_REVIEW",
        readyForAllocation: false,
        hrefAllocate: null,
      });
    }
  }

  return {
    confirmedForReview: confirmed.slice(0, 8),
    revisedAwaitingDecision: revised.slice(0, 8),
    counts: {
      confirmedForReview: confirmed.length,
      revisedAwaitingDecision: revised.length,
      readyForAllocation: confirmed.filter((r) => r.readyForAllocation).length,
    },
  };
}
