"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  rescheduleDeliveryAction,
  type RescheduleDeliveryActionResult,
} from "@/app/supplier/orders/delivery-actions";
import { buttonVariants } from "@/components/ui/button";
import { todayCalendarDateInPortalTz } from "@/lib/dates";
import { createDeliveryIdempotencyKey } from "@/lib/deliveries/idempotency-client";
import { cn } from "@/lib/utils";

type Line = {
  orderItemId: string;
  productName: string;
  productSku: string | null;
  quantityPlanned: string;
  remainingDeliverable: string;
};

export function RescheduleDeliveryForm({
  deliveryId,
  orderNumber,
  lines,
}: {
  deliveryId: string;
  orderNumber: string;
  lines: Line[];
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(createDeliveryIdempotencyKey);
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.orderItemId, l.quantityPlanned])),
  );

  const [state, action, pending] = useActionState(
    async (
      prev: RescheduleDeliveryActionResult | undefined,
      formData: FormData,
    ) => {
      const result = await rescheduleDeliveryAction(prev, formData);
      if (result.ok) {
        router.push(`/supplier/orders/${result.purchaseOrderId}/deliver`);
        router.refresh();
      }
      return result;
    },
    undefined as RescheduleDeliveryActionResult | undefined,
  );

  const hasAnyQty = useMemo(
    () => lines.some((l) => Number(qtys[l.orderItemId] || 0) > 0),
    [lines, qtys],
  );
  const minDeliveryDate = todayCalendarDateInPortalTz();

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="deliveryId" value={deliveryId} />

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Reschedule delivery</h2>
        <p className="text-sm text-muted-foreground">
          Update the plan for {orderNumber}. A reason is required. The previous
          schedule stays in history.
        </p>
      </div>

      {state && !state.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      {state && state.ok ? (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          Reschedule saved. Returning to the delivery plan…
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">New planned delivery date</span>
        <input
          type="date"
          name="plannedDeliveryAt"
          required
          min={minDeliveryDate}
          disabled={pending}
          className="min-h-11 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        {state && !state.ok && state.fieldErrors?.plannedDeliveryAt ? (
          <span className="text-xs text-destructive">
            {state.fieldErrors.plannedDeliveryAt}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Reason for reschedule</span>
        <textarea
          name="rescheduleReason"
          rows={2}
          required
          disabled={pending}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-required="true"
        />
        {state && !state.ok && state.fieldErrors?.rescheduleReason ? (
          <span className="text-xs text-destructive">
            {state.fieldErrors.rescheduleReason}
          </span>
        ) : null}
      </label>

      <ul className="flex flex-col gap-3">
        {lines.map((line) => (
          <li
            key={line.orderItemId}
            className="rounded-lg border border-border p-4"
          >
            <input type="hidden" name="orderItemId" value={line.orderItemId} />
            <p className="font-medium">{line.productName}</p>
            <p className="text-xs text-muted-foreground">
              {line.productSku ?? "—"}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Previous plan</dt>
                <dd className="tabular-nums">{line.quantityPlanned}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Remaining capacity</dt>
                <dd className="tabular-nums">{line.remainingDeliverable}</dd>
              </div>
            </dl>
            <label className="mt-3 flex flex-col gap-1.5 text-sm sm:max-w-xs">
              <span className="font-medium">New plan</span>
              <input
                name="quantity"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={qtys[line.orderItemId] ?? ""}
                onChange={(e) =>
                  setQtys((prev) => ({
                    ...prev,
                    [line.orderItemId]: e.target.value,
                  }))
                }
                disabled={pending}
                className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base"
                aria-label={`New planned quantity for ${line.productName}`}
              />
            </label>
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Notes (optional)</span>
        <textarea
          name="notes"
          rows={2}
          disabled={pending}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="confirmed"
          value="true"
          disabled={pending}
          required
          className="mt-1"
        />
        <span>I confirm this reschedule is accurate</span>
      </label>

      <button
        type="submit"
        disabled={pending || !hasAnyQty}
        aria-busy={pending}
        className={cn(
          buttonVariants({ className: "min-h-11 w-full sm:w-fit" }),
        )}
      >
        {pending ? "Saving…" : "Save reschedule"}
      </button>
    </form>
  );
}
