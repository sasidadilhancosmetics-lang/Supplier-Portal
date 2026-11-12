"use client";

import { useActionState, useState } from "react";

import {
  saveAvailabilityDraftAction,
  submitAvailabilityAction,
  type ActionResult,
} from "@/app/supplier/requests/actions";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime, toCalendarDateInputValue } from "@/lib/dates";
import { cn } from "@/lib/utils";

type ItemRow = {
  id: string;
  quantityRequested: string;
  product: {
    name: string;
    sku: string | null;
    priorityStatus: string;
    unitOfMeasure: string | null;
  };
  offer: {
    status: string;
    quantityDeclared: string;
    availableDate: Date | string | null;
    reserveExpiresAt: Date | string | null;
    notes: string | null;
    version: number;
  } | null;
};

function fieldError(
  state: ActionResult | undefined,
  key: string,
): string | undefined {
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[key];
}

export function AvailabilityForm({
  supplierRequestId,
  items,
}: {
  supplierRequestId: string;
  items: ItemRow[];
}) {
  const [bulkDate, setBulkDate] = useState("");
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        toCalendarDateInputValue(item.offer?.availableDate),
      ]),
    ),
  );
  const [na, setNa] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        item.offer?.status === "NOT_AVAILABLE" || false,
      ]),
    ),
  );
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const [draftState, draftAction, draftPending] = useActionState(
    saveAvailabilityDraftAction,
    undefined as ActionResult | undefined,
  );
  const [submitState, submitAction, submitPending] = useActionState(
    submitAvailabilityAction,
    undefined as ActionResult | undefined,
  );

  const pending = draftPending || submitPending;
  const activeErrorState =
    submitState && !submitState.ok
      ? submitState
      : draftState && !draftState.ok
        ? draftState
        : undefined;

  function markAllNa() {
    setNa(Object.fromEntries(items.map((item) => [item.id, true])));
  }

  function applyBulkDate() {
    if (!bulkDate) return;
    setDates((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!na[item.id]) next[item.id] = bulkDate;
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Bulk delivery date</span>
          <input
            type="date"
            value={bulkDate}
            onChange={(e) => setBulkDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={applyBulkDate}
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Apply date to all
        </button>
        <button
          type="button"
          onClick={markAllNa}
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Mark all not available
        </button>
      </div>

      {activeErrorState ? (
        <p role="alert" className="text-sm text-destructive">
          {activeErrorState.error}
        </p>
      ) : null}
      {draftState?.ok || submitState?.ok ? (
        <p role="status" className="rounded-lg border bg-muted px-4 py-3 text-sm">
          {submitState?.ok ? "Submitted." : "Draft saved."}
        </p>
      ) : null}

      <form id="availability-form" className="flex flex-col gap-4">
        <input type="hidden" name="supplierRequestId" value={supplierRequestId} />
        {items.map((item) => {
          const qtyError = fieldError(activeErrorState, `${item.id}:quantity`);
          const dateError = fieldError(activeErrorState, `${item.id}:date`);
          const versionError = fieldError(activeErrorState, `${item.id}:version`);

          return (
            <div key={item.id} className="rounded-lg border p-4">
              <input type="hidden" name="requestItemId" value={item.id} />
              {item.offer?.version != null ? (
                <input
                  type="hidden"
                  name={`expectedVersion:${item.id}`}
                  value={item.offer.version}
                />
              ) : null}
              <input
                type="hidden"
                name={`notAvailable:${item.id}`}
                value={na[item.id] ? "true" : "false"}
              />
              <div className="flex flex-col gap-1">
                <p className="font-medium">{item.product.name}</p>
                <p className="text-sm text-muted-foreground">
                  Requested {item.quantityRequested}
                  {item.product.unitOfMeasure
                    ? ` ${item.product.unitOfMeasure}`
                    : ""}{" "}
                  · {item.product.priorityStatus}
                  {item.product.sku ? ` · ${item.product.sku}` : ""}
                </p>
                {item.offer?.status === "SUBMITTED" &&
                item.offer.reserveExpiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    Reserve active until{" "}
                    {formatDateTime(item.offer.reserveExpiresAt)}. Editing
                    quantity keeps this deadline.
                  </p>
                ) : null}
                {item.offer?.status === "EXPIRED" ? (
                  <p className="text-xs text-muted-foreground">
                    Previous reserve expired. Submitting a positive quantity
                    starts a new 7-day reserve.
                  </p>
                ) : null}
                {versionError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {versionError}
                  </p>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Available qty</span>
                  <input
                    name={`quantityDeclared:${item.id}`}
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    disabled={Boolean(na[item.id])}
                    defaultValue={
                      item.offer && item.offer.status !== "NOT_AVAILABLE"
                        ? item.offer.quantityDeclared
                        : ""
                    }
                    aria-invalid={Boolean(qtyError)}
                    className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
                  />
                  {qtyError ? (
                    <span role="alert" className="text-sm text-destructive">
                      {qtyError}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Leave blank to keep unanswered.
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Delivery date</span>
                  <input
                    name={`availableDate:${item.id}`}
                    type="date"
                    disabled={Boolean(na[item.id])}
                    value={dates[item.id] ?? ""}
                    onChange={(e) =>
                      setDates((prev) => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    aria-invalid={Boolean(dateError)}
                    className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
                  />
                  {dateError ? (
                    <span role="alert" className="text-sm text-destructive">
                      {dateError}
                    </span>
                  ) : null}
                </label>
              </div>

              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(na[item.id])}
                  onChange={(e) =>
                    setNa((prev) => ({ ...prev, [item.id]: e.target.checked }))
                  }
                  className="size-4"
                />
                Not available
              </label>

              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-sm font-medium">Notes</span>
                <input
                  name={`notes:${item.id}`}
                  defaultValue={item.offer?.notes ?? ""}
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
                />
              </label>
            </div>
          );
        })}
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          form="availability-form"
          formAction={draftAction}
          disabled={pending}
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          {draftPending ? "Saving…" : "Save draft"}
        </button>
        {!confirmSubmit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmSubmit(true)}
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Submit responses
          </button>
        ) : (
          <>
            <button
              type="submit"
              form="availability-form"
              formAction={submitAction}
              disabled={pending}
              className={cn(buttonVariants({ className: "min-h-11" }))}
            >
              {submitPending ? "Submitting…" : "Confirm submit"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmSubmit(false)}
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
