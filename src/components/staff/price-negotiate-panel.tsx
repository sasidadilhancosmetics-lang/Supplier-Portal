"use client";

import { useActionState } from "react";

import {
  staffAttestAction,
  staffCounterOfferAction,
  staffRecordExternalAction,
  type PricingActionResult,
} from "@/app/staff/pricing/actions";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type QuoteRow = {
  id: string;
  kind: string;
  status: string;
  channel: string;
  unitPrice: string;
  notes: string | null;
  attestationStatement: string | null;
  evidenceNote: string | null;
  createdAt: Date | string;
  recordedBy: { name: string | null; email: string } | null;
};

export function PriceNegotiatePanel({
  availabilityOfferId,
  productId,
  agreement,
  quotes,
}: {
  availabilityOfferId: string;
  productId: string;
  agreement: {
    status: string;
    version: number;
    unitPrice: string;
    channel: string;
  } | null;
  quotes: QuoteRow[];
}) {
  const [counterState, counterAction, counterPending] = useActionState(
    staffCounterOfferAction,
    undefined as PricingActionResult | undefined,
  );
  const [externalState, externalAction, externalPending] = useActionState(
    staffRecordExternalAction,
    undefined as PricingActionResult | undefined,
  );
  const [attestState, attestAction, attestPending] = useActionState(
    staffAttestAction,
    undefined as PricingActionResult | undefined,
  );

  const pending = counterPending || externalPending || attestPending;
  const error =
    (counterState && !counterState.ok && counterState.error) ||
    (externalState && !externalState.ok && externalState.error) ||
    (attestState && !attestState.ok && attestState.error) ||
    null;

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Price history</h2>
        <p className="text-sm text-muted-foreground">
          Append-only events. Quoted history is not the same as a purchased
          order price.
        </p>
        <ul className="flex flex-col gap-2">
          {quotes.map((q) => (
            <li
              key={q.id}
              className="rounded-lg border px-4 py-3 text-sm"
            >
              <div className="font-medium">
                {q.unitPrice} LKR · {q.kind} · {q.status} · {q.channel}
              </div>
              <div className="text-muted-foreground">
                {formatDateTime(q.createdAt)}
                {q.recordedBy
                  ? ` · recorded by ${q.recordedBy.name ?? q.recordedBy.email}`
                  : ""}
              </div>
              {q.notes ? <p className="mt-1">{q.notes}</p> : null}
              {q.attestationStatement ? (
                <p className="mt-1">Attestation: {q.attestationStatement}</p>
              ) : null}
              {q.evidenceNote ? (
                <p className="mt-1">Evidence: {q.evidenceNote}</p>
              ) : null}
            </li>
          ))}
          {quotes.length === 0 ? (
            <li className="text-sm text-muted-foreground">No quotes yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Portal counteroffer</h2>
        <form action={counterAction} className="grid gap-3 sm:grid-cols-2">
          <input
            type="hidden"
            name="availabilityOfferId"
            value={availabilityOfferId}
          />
          <input type="hidden" name="productId" value={productId} />
          <input
            type="hidden"
            name="expectedVersion"
            value={agreement?.version ?? 1}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Counter unit price (LKR)</span>
            <input
              name="unitPrice"
              type="number"
              step="0.01"
              min="0"
              required
              disabled={pending}
              className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Notes</span>
            <input
              name="notes"
              disabled={pending}
              className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending || !agreement}
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            {counterPending ? "Sending…" : "Send counteroffer"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Phone / WhatsApp record</h2>
        <p className="text-sm text-muted-foreground">
          Records an unconfirmed staff price. Allocate requires attestation or
          supplier portal confirmation.
        </p>
        <form action={externalAction} className="grid gap-3 sm:grid-cols-2">
          <input
            type="hidden"
            name="availabilityOfferId"
            value={availabilityOfferId}
          />
          <input type="hidden" name="productId" value={productId} />
          <input
            type="hidden"
            name="expectedVersion"
            value={agreement?.version ?? 1}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Channel</span>
            <select
              name="channel"
              disabled={pending}
              className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
              defaultValue="PHONE"
            >
              <option value="PHONE">Phone</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Agreed unit price (LKR)</span>
            <input
              name="unitPrice"
              type="number"
              step="0.01"
              min="0"
              required
              disabled={pending}
              className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Negotiation date</span>
            <input
              name="negotiationOccurredAt"
              type="datetime-local"
              required
              disabled={pending}
              className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
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
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            {externalPending ? "Saving…" : "Record negotiation"}
          </button>
        </form>
      </section>

      {agreement?.status === "STAFF_RECORDED_UNCONFIRMED" ? (
        <section className="flex flex-col gap-3 rounded-lg border border-primary/40 p-4">
          <h2 className="text-lg font-medium">Attest agreed price</h2>
          <p className="text-sm text-muted-foreground">
            Required before using a phone/WhatsApp price on a purchase order.
            Current recorded price: {agreement.unitPrice} LKR.
          </p>
          <form action={attestAction} className="grid gap-3">
            <input
              type="hidden"
              name="availabilityOfferId"
              value={availabilityOfferId}
            />
            <input type="hidden" name="productId" value={productId} />
            <input
              type="hidden"
              name="expectedVersion"
              value={agreement.version}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Attestation statement</span>
              <textarea
                name="attestationStatement"
                required
                minLength={10}
                disabled={pending}
                rows={3}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="I confirm the supplier agreed to this unit price..."
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Confirmation evidence</span>
              <textarea
                name="evidenceNote"
                required
                minLength={3}
                disabled={pending}
                rows={2}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="WhatsApp message timestamp, call log, etc."
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className={cn(buttonVariants({ className: "min-h-11" }))}
            >
              {attestPending ? "Attesting…" : "Attest agreed price"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
