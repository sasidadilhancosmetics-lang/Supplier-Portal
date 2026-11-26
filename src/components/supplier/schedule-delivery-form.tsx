"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  scheduleDeliveryAction,
  type ScheduleDeliveryActionResult,
} from "@/app/supplier/orders/delivery-actions";
import { buttonVariants } from "@/components/ui/button";
import { todayCalendarDateInPortalTz } from "@/lib/dates";
import {
  createDeliveryIdempotencyKey,
  emptyDeliverNowQuantities,
  rotateDeliveryIdempotencyKey,
} from "@/lib/deliveries/idempotency-client";
import { cn } from "@/lib/utils";

type Line = {
  orderItemId: string;
  productName: string;
  productSku: string | null;
  unitOfMeasure: string | null;
  quantityOrdered: string;
  quantityVerifiedReceived: string;
  submittedHold: string;
  remainingDeliverable: string;
  expectedDeliveryLabel: string;
  canSubmit: boolean;
};

export function ScheduleDeliveryForm({
  purchaseOrderId,
  orderNumber,
  lines,
}: {
  purchaseOrderId: string;
  orderNumber: string;
  lines: Line[];
}) {
  const router = useRouter();
  const orderItemIds = useMemo(
    () => lines.map((l) => l.orderItemId),
    [lines],
  );

  const [idempotencyKey, setIdempotencyKey] = useState(
    createDeliveryIdempotencyKey,
  );
  const [formEpoch, setFormEpoch] = useState(0);
  const [qtys, setQtys] = useState(() =>
    emptyDeliverNowQuantities(orderItemIds),
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const remainingSignature = JSON.stringify([
    purchaseOrderId,
    lines.map((line) => [
      line.orderItemId,
      line.remainingDeliverable,
      line.submittedHold,
      line.quantityVerifiedReceived,
    ]),
  ]);
  const [previousSignature, setPreviousSignature] = useState(remainingSignature);
  if (previousSignature !== remainingSignature) {
    setPreviousSignature(remainingSignature);
    setQtys(emptyDeliverNowQuantities(orderItemIds));
  }

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      setIdempotencyKey(rotateDeliveryIdempotencyKey());
      setQtys(emptyDeliverNowQuantities(orderItemIds));
      setFormEpoch((n) => n + 1);
      setSuccessMessage(null);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [orderItemIds]);

  const [state, action, pending] = useActionState(
    async (
      prev: ScheduleDeliveryActionResult | undefined,
      formData: FormData,
    ) => {
      const result = await scheduleDeliveryAction(prev, formData);
      if (result.ok) {
        setIdempotencyKey(rotateDeliveryIdempotencyKey());
        setQtys(emptyDeliverNowQuantities(orderItemIds));
        setFormEpoch((n) => n + 1);
        setSuccessMessage(
          "Delivery planned. The company will record receipt when goods arrive — this is not proof of delivery.",
        );
        router.refresh();
      } else {
        setSuccessMessage(null);
      }
      return result;
    },
    undefined as ScheduleDeliveryActionResult | undefined,
  );

  const hasAnyQty = useMemo(
    () => lines.some((l) => Number(qtys[l.orderItemId] || 0) > 0),
    [lines, qtys],
  );
  const minDeliveryDate = todayCalendarDateInPortalTz();
  const totalRemaining = useMemo(
    () =>
      lines.reduce((acc, l) => acc + Number(l.remainingDeliverable || 0), 0),
    [lines],
  );

  return (
    <form key={formEpoch} action={action} className="flex flex-col gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Plan Your Delivery</h2>
        <p className="text-sm text-muted-foreground">
          Scheduling is a plan for {orderNumber}, not proof that goods were
          received. Remaining to schedule:{" "}
          <span className="font-medium text-foreground tabular-nums">
            {totalRemaining}
          </span>
          .
        </p>
      </div>

      {successMessage ? (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          {successMessage}
        </div>
      ) : null}

      {state && !state.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Planned delivery date</span>
        <input
          type="date"
          name="plannedDeliveryAt"
          required
          min={minDeliveryDate}
          disabled={pending}
          className="min-h-11 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          Today or later (Asia/Colombo).
        </span>
        {state && !state.ok && state.fieldErrors?.plannedDeliveryAt ? (
          <span className="text-xs text-destructive">
            {state.fieldErrors.plannedDeliveryAt}
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{line.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {line.productSku ?? "—"}
                  {line.expectedDeliveryLabel
                    ? ` · Expected ${line.expectedDeliveryLabel}`
                    : ""}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Ordered</dt>
                    <dd className="tabular-nums">{line.quantityOrdered}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Received</dt>
                    <dd className="tabular-nums">
                      {line.quantityVerifiedReceived}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Scheduled</dt>
                    <dd className="tabular-nums">{line.submittedHold}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Remaining</dt>
                    <dd className="tabular-nums font-medium">
                      {line.remainingDeliverable}
                    </dd>
                  </div>
                </dl>
              </div>
              <label className="flex w-full flex-col gap-1.5 text-sm sm:w-36">
                <span className="font-medium">Plan now</span>
                <input
                  name={`quantity:${line.orderItemId}`}
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
                  disabled={pending || !line.canSubmit}
                  placeholder={line.canSubmit ? "Qty" : "—"}
                  className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base disabled:opacity-60"
                  aria-label={`Planned quantity for ${line.productName}`}
                  aria-invalid={Boolean(
                    state &&
                      !state.ok &&
                      state.fieldErrors?.[line.orderItemId],
                  )}
                />
                {state &&
                !state.ok &&
                state.fieldErrors?.[line.orderItemId] ? (
                  <span role="alert" className="text-xs text-destructive">
                    {state.fieldErrors[line.orderItemId]}
                  </span>
                ) : null}
              </label>
            </div>
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
        <span>I confirm these planned quantities are accurate</span>
      </label>

      <button
        type="submit"
        disabled={pending || !hasAnyQty}
        aria-busy={pending}
        className={cn(
          buttonVariants({
            className: "min-h-11 w-full sm:w-fit",
          }),
        )}
      >
        {pending ? "Saving plan…" : "Save delivery plan"}
      </button>
    </form>
  );
}
