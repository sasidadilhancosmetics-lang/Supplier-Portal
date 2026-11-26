import { Badge } from "@/components/ui/badge";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import type { AvailabilitySplit } from "@/lib/requests/availability-splits";
import { isLiveReserve } from "@/lib/requests/reserve";
import {
  isAgreedPriceAgreementStatus,
  itemNeedsAvailabilityAnswer,
} from "@/lib/supplier/request-labels";

type SummaryItem = {
  id: string;
  product: { name: string; unitOfMeasure?: string | null };
  offer: {
    status: string;
    quantityDeclared?: string;
    unitPrice?: string | null;
    supplierQuotedUnitPrice?: string | null;
    availableDate?: Date | string | null;
    splits?: AvailabilitySplit[];
    reserveExpiresAt?: Date | string | null;
    priceAgreement?: {
      status: string;
      unitPrice: string;
    } | null;
  } | null;
};

function priceLabel(offer: NonNullable<SummaryItem["offer"]>) {
  if (isAgreedPriceAgreementStatus(offer.priceAgreement?.status)) {
    return {
      amount: offer.priceAgreement!.unitPrice,
      status: "Agreed price",
    };
  }
  if (offer.priceAgreement?.status === "COUNTER_PENDING") {
    return {
      amount: offer.supplierQuotedUnitPrice ?? offer.unitPrice ?? null,
      status: "Your offered price",
    };
  }
  const amount = offer.supplierQuotedUnitPrice ?? offer.unitPrice ?? null;
  return {
    amount,
    status: amount ? "Your offered price" : "Unit price",
  };
}

/**
 * Compact read-out of submitted availability lines.
 * Does not replace pending counteroffer actions.
 */
export function AvailabilityResponseSummary({
  items,
}: {
  items: SummaryItem[];
}) {
  const answered = items.filter((item) => !itemNeedsAvailabilityAnswer(item));
  if (answered.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="availability-response-heading"
    >
      <h2 id="availability-response-heading" className="text-lg font-medium">
        Your response
      </h2>
      <ul className="flex flex-col gap-3">
        {answered.map((item) => {
          const offer = item.offer!;
          const unit = item.product.unitOfMeasure
            ? ` ${item.product.unitOfMeasure}`
            : "";
          const notAvailable = offer.status === "NOT_AVAILABLE";
          const price = notAvailable ? null : priceLabel(offer);
          const live = isLiveReserve(
            offer.status
              ? {
                  status: offer.status,
                  reserveExpiresAt: offer.reserveExpiresAt ?? null,
                }
              : null,
          );
          const reserveText =
            !notAvailable && offer.reserveExpiresAt
              ? live
                ? `Until ${formatDateTime(offer.reserveExpiresAt)}`
                : `Ended ${formatDateTime(offer.reserveExpiresAt)}`
              : null;

          return (
            <li
              key={item.id}
              className="rounded-lg border border-border bg-card p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium leading-snug">{item.product.name}</p>
                {notAvailable ? (
                  <Badge variant="outline">Not available</Badge>
                ) : isAgreedPriceAgreementStatus(
                    offer.priceAgreement?.status,
                  ) ? (
                  <Badge>Price agreed</Badge>
                ) : null}
              </div>
              {notAvailable ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Marked not available.
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Quantity</dt>
                    <dd className="font-medium tabular-nums">
                      {offer.quantityDeclared ?? "—"}
                      {unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Available dates</dt>
                    <dd className="font-medium">
                      {offer.splits?.length ? (
                        <ul className="space-y-1">
                          {offer.splits.map((split) => (
                            <li key={split.date}>{split.quantity}{unit} · {formatCalendarDate(split.date)}</li>
                          ))}
                        </ul>
                      ) : formatCalendarDate(offer.availableDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {price?.status ?? "Unit price"}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {price?.amount ? `${price.amount} LKR` : "—"}
                    </dd>
                  </div>
                  {reserveText ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">Reserve</dt>
                      <dd className="font-medium text-xs sm:text-sm">
                        {reserveText}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
