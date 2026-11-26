import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceNegotiatePanel } from "@/components/staff/price-negotiate-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isAuthorizationError } from "@/lib/auth/errors";
import { formatCalendarDate } from "@/lib/dates";
import { isPricingDomainError } from "@/lib/pricing/errors";
import { getOfferPriceThread } from "@/lib/pricing/comparison";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = { params: Promise<{ offerId: string }> };

export const metadata: Metadata = { title: "Negotiate price" };

export default async function NegotiateOfferPricePage({ params }: PageProps) {
  const { offerId } = await params;
  let offer;
  try {
    offer = await getOfferPriceThread(offerId);
  } catch (error) {
    if (
      (isPricingDomainError(error) && error.code === "NOT_FOUND") ||
      (isAuthorizationError(error) && error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }

  const agreement = offer.priceAgreement
    ? {
        status: offer.priceAgreement.status,
        version: offer.priceAgreement.version,
        unitPrice: offer.priceAgreement.unitPrice.toString(),
        channel: offer.priceAgreement.channel,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {offer.requestItem.product.name}
            </h1>
            {agreement ? (
              <Badge variant="outline">{agreement.status}</Badge>
            ) : (
              <Badge variant="outline">NO_AGREEMENT</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {offer.supplier.name} · qty {offer.quantityDeclared.toString()} ·
            delivery {formatCalendarDate(offer.availableDate) || "—"}
            {agreement ? ` · ${agreement.unitPrice} LKR` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/staff/products/${offer.requestItem.productId}/prices`}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Compare prices
          </Link>
          <Link
            href={`/staff/requests/${offer.requestItem.supplierRequestId}`}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Back to request
          </Link>
        </div>
      </div>

      <PriceNegotiatePanel
        availabilityOfferId={offer.id}
        productId={offer.requestItem.productId}
        agreement={agreement}
        quotes={offer.priceQuotes.map((quote) => ({
          id: quote.id,
          kind: quote.kind,
          status: quote.status,
          channel: quote.channel,
          unitPrice: quote.unitPrice.toString(),
          notes: quote.notes,
          attestationStatement: quote.attestationStatement,
          evidenceNote: quote.evidenceNote,
          createdAt: quote.createdAt,
          recordedBy: quote.recordedBy,
        }))}
      />
    </div>
  );
}
