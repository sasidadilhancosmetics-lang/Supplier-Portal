import { Badge } from "@/components/ui/badge";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { isLiveReserve } from "@/lib/requests/reserve";
import { supplierOfferStatusLabel } from "@/lib/supplier/request-labels";

type ConfirmedItem = {
  id: string;
  product: { name: string; unitOfMeasure?: string | null };
  offer: {
    id?: string;
    status?: string;
    quantityDeclared?: string;
    unitPrice?: string | null;
    availableDate?: Date | string | null;
    reserveExpiresAt?: Date | string | null;
    priceAgreement?: {
      status: string;
      unitPrice: string;
      currentQuoteKind?: string | null;
    } | null;
  } | null;
};

function isConfirmedAgreement(status: string | undefined): boolean {
  return status === "SUPPLIER_CONFIRMED" || status === "STAFF_ATTESTED_AGREED";
}

/**
 * Compact confirmation for SUPPLIER_CONFIRMED (and staff-attested) lines.
 * Uses live offer + agreement fields from the database only.
 */
export function ConfirmedPriceSummary({ items }: { items: ConfirmedItem[] }) {
  const confirmed = items.filter((item) =>
    isConfirmedAgreement(item.offer?.priceAgreement?.status),
  );

  if (confirmed.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
      aria-labelledby="confirmed-price-heading"
    >
      <div>
        <h2 id="confirmed-price-heading" className="text-lg font-medium">
          Price agreed
        </h2>
        <p className="text-sm text-muted-foreground" role="status">
          Price agreement confirmed. No further submission required.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {confirmed.map((item) => {
          const offer = item.offer!;
          const agreement = offer.priceAgreement!;
          const unit = item.product.unitOfMeasure
            ? ` ${item.product.unitOfMeasure}`
            : "";
          const live = isLiveReserve(
            offer.status
              ? {
                  status: offer.status,
                  reserveExpiresAt: offer.reserveExpiresAt ?? null,
                }
              : null,
          );
          const reserveText = offer.reserveExpiresAt
            ? live
              ? `Until ${formatDateTime(offer.reserveExpiresAt)}`
              : `Expired ${formatDateTime(offer.reserveExpiresAt)}`
            : "No active reserve";

          return (
            <li
              key={item.id}
              className="flex flex-col gap-2 border-t border-primary/20 pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.product.name}</p>
                <Badge>Price Agreed</Badge>
                {offer.status ? (
                  <Badge variant="outline">
                    {supplierOfferStatusLabel(offer.status)}
                  </Badge>
                ) : null}
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Agreed unit price
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {agreement.unitPrice} LKR
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Available quantity
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {offer.quantityDeclared ?? "—"}
                    {unit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Expected delivery
                  </dt>
                  <dd className="font-medium">
                    {formatCalendarDate(offer.availableDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Availability reserve
                  </dt>
                  <dd className="font-medium">{reserveText}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
