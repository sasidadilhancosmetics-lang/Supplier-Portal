"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  supplierAcceptCounterAction,
  supplierReviseOfferAction,
  type SupplierPriceActionResult,
} from "@/app/supplier/requests/price-actions";
import { buttonVariants } from "@/components/ui/button";
import type { CounterNegotiationDisplay } from "@/lib/pricing/supplier-negotiation-types";
import { cn } from "@/lib/utils";

type CounterItem = {
  id: string;
  product: { name: string };
  offer: {
    id?: string;
    unitPrice?: string | null;
    supplierQuotedUnitPrice?: string | null;
    priceAgreement?: {
      status: string;
      version: number;
      unitPrice: string;
      currentQuoteKind?: string | null;
    } | null;
    negotiation?: CounterNegotiationDisplay | null;
  } | null;
};

function PriceRow({
  label,
  value,
  hint,
  emphasize = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm",
          emphasize ? "font-semibold text-foreground" : "font-medium",
        )}
      >
        {value}
      </dd>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function PriceCounterResponse({
  supplierRequestId,
  items,
  focusOfferId = null,
  autoFocus = false,
}: {
  supplierRequestId: string;
  items: CounterItem[];
  focusOfferId?: string | null;
  autoFocus?: boolean;
}) {
  const pendingCounters = items.filter(
    (item) =>
      item.offer?.id &&
      item.offer.priceAgreement?.status === "COUNTER_PENDING",
  );

  const [acceptState, acceptAction, acceptPending] = useActionState(
    supplierAcceptCounterAction,
    undefined as SupplierPriceActionResult | undefined,
  );
  const [reviseState, reviseAction, revisePending] = useActionState(
    supplierReviseOfferAction,
    undefined as SupplierPriceActionResult | undefined,
  );

  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!autoFocus || pendingCounters.length === 0) return;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [autoFocus, pendingCounters.length]);

  if (pendingCounters.length === 0) return null;

  const error =
    (acceptState && !acceptState.ok && acceptState.error) ||
    (reviseState && !reviseState.ok && reviseState.error) ||
    null;
  const pending = acceptPending || revisePending;

  return (
    <section
      ref={sectionRef}
      className="flex flex-col gap-4 rounded-lg border border-primary/40 p-4"
      aria-labelledby="price-counter-heading"
    >
      <div>
        <h2 id="price-counter-heading" className="text-lg font-medium">
          Company counteroffers
        </h2>
        <p className="text-sm text-muted-foreground">
          Compare your quote with the company counter, then accept or revise.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pendingCounters.map((item) => {
        const isFocused = Boolean(
          focusOfferId && item.offer?.id === focusOfferId,
        );
        const negotiation = item.offer?.negotiation;
        const currency = negotiation?.currencyCode ?? "LKR";
        const companyPrice =
          negotiation?.companyCounterPrice ??
          item.offer!.priceAgreement!.unitPrice;
        const yourQuote =
          negotiation?.currentSupplierQuote?.unitPrice ??
          item.offer?.supplierQuotedUnitPrice ??
          null;
        const lastPurchase = negotiation?.lastPurchase ?? null;
        const previousQuoted = negotiation?.previousQuotedPrice ?? null;

        return (
          <div
            key={item.id}
            id={item.offer?.id ? `offer-${item.offer.id}` : undefined}
            className={cn(
              "flex flex-col gap-3 border-t pt-3",
              isFocused && "rounded-md bg-primary/10 p-3",
            )}
          >
            <p className="font-medium">{item.product.name}</p>

            <dl className="grid gap-3 sm:grid-cols-2">
              <PriceRow
                label="Company counteroffer (pending)"
                value={`${companyPrice} ${currency}`}
                hint="Not accepted yet — not your current quote"
                emphasize
              />
              <PriceRow
                label="Your current quoted price"
                value={
                  yourQuote
                    ? `${yourQuote} ${currency}`
                    : "Not available"
                }
              />
              <PriceRow
                label="Last purchased unit price"
                value={
                  lastPurchase
                    ? `${lastPurchase.unitPrice} ${lastPurchase.currencyCode}`
                    : "No previous purchase"
                }
                hint={
                  lastPurchase
                    ? [
                        lastPurchase.purchasedAtLabel
                          ? `Purchased ${lastPurchase.purchasedAtLabel}`
                          : null,
                        lastPurchase.orderNumber
                          ? `PO ${lastPurchase.orderNumber}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    : undefined
                }
              />
              {previousQuoted ? (
                <PriceRow
                  label="Your previous quoted price"
                  value={`${previousQuoted.unitPrice} ${previousQuoted.currencyCode}`}
                  hint={`Earlier quote · ${previousQuoted.createdAtLabel}`}
                />
              ) : null}
            </dl>

            <div className="flex flex-wrap gap-2">
              <form action={acceptAction}>
                <input
                  type="hidden"
                  name="availabilityOfferId"
                  value={item.offer!.id}
                />
                <input
                  type="hidden"
                  name="supplierRequestId"
                  value={supplierRequestId}
                />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={item.offer!.priceAgreement!.version}
                />
                <button
                  type="submit"
                  disabled={pending}
                  aria-busy={acceptPending || undefined}
                  className={cn(buttonVariants({ className: "min-h-11" }))}
                >
                  {acceptPending ? "Accepting…" : "Accept counter"}
                </button>
              </form>
            </div>
            <form action={reviseAction} className="grid gap-2 sm:grid-cols-2">
              <input
                type="hidden"
                name="availabilityOfferId"
                value={item.offer!.id}
              />
              <input
                type="hidden"
                name="supplierRequestId"
                value={supplierRequestId}
              />
              <input
                type="hidden"
                name="expectedVersion"
                value={item.offer!.priceAgreement!.version}
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Revised unit price (LKR)
                </span>
                <input
                  name="unitPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  disabled={pending}
                  placeholder={yourQuote ?? undefined}
                  aria-label="Revised unit price in LKR"
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-base"
                />
                <span className="text-xs text-muted-foreground">
                  Starts empty — company counter is not prefilled.
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Notes</span>
                <input
                  name="notes"
                  disabled={pending}
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                aria-busy={revisePending || undefined}
                className={cn(
                  buttonVariants({
                    variant: "outline",
                    className: "min-h-11",
                  }),
                )}
              >
                {revisePending ? "Sending…" : "Send revised offer"}
              </button>
            </form>
          </div>
        );
      })}
    </section>
  );
}
