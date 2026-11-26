"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import {
  saveAvailabilityDraftAction,
  submitAvailabilityAction,
  type ActionResult,
} from "@/app/supplier/requests/actions";
import { AvailabilityResponseSummary } from "@/components/supplier/availability-response-summary";
import { buttonVariants } from "@/components/ui/button";
import {
  formatDateTime,
  formatShortDateTime,
  toCalendarDateInputValue,
} from "@/lib/dates";
import { isLiveReserve } from "@/lib/requests/reserve";
import {
  availabilitySplitsSchema, maxAvailabilitySplits, quantityUnits, totalAvailability, type AvailabilitySplit,
} from "@/lib/requests/availability-splits";
import { meetsCatalogueMoq } from "@/lib/supplier/catalogue-price-suggestion";
import {
  editableUnitPriceDefault,
  isAgreedPriceAgreementStatus,
  itemNeedsAvailabilityAnswer,
  shouldCollapseAvailabilityEditor,
} from "@/lib/supplier/request-labels";
import { cn } from "@/lib/utils";

type ItemRow = {
  id: string;
  quantityRequested: string;
  savedCataloguePrice?: { unitPrice: string; moq: string | null } | null;
  product: {
    name: string;
    sku: string | null;
    priorityStatus: string;
    unitOfMeasure: string | null;
  };
  offer: {
    id?: string;
    status: string;
    quantityDeclared: string;
    unitPrice?: string | null;
    /** Own quote for editable fields — never the unaccepted company counter. */
    supplierQuotedUnitPrice?: string | null;
    availableDate: Date | string | null;
    splits?: AvailabilitySplit[];
    reserveExpiresAt: Date | string | null;
    notes: string | null;
    version: number;
    priceAgreement?: {
      status: string;
      version: number;
      unitPrice: string;
      channel: string;
      currentQuoteKind?: string | null;
    } | null;
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
  const unanswered = items.filter(itemNeedsAvailabilityAnswer);
  const collapseByDefault = shouldCollapseAvailabilityEditor(items);
  const hasExistingResponse = items.some(
    (item) => item.offer && !itemNeedsAvailabilityAnswer(item),
  );
  const [editing, setEditing] = useState(!collapseByDefault);
  const showBulk = items.length > 1;

  const [bulkDate, setBulkDate] = useState("");
  const [splits, setSplits] = useState<Record<string, (AvailabilitySplit & { key: string })[]>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        (item.offer?.splits?.length ? item.offer.splits : [{
          quantity: item.offer?.status !== "NOT_AVAILABLE" ? item.offer?.quantityDeclared ?? "" : "",
          date: toCalendarDateInputValue(item.offer?.availableDate),
        }]).map((row, index) => ({ ...row, key: String(index) })),
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
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const editedPrices = useRef(new Set<string>());
  const [savedPriceFeedback, setSavedPriceFeedback] = useState<Record<string, string>>({});

  const [draftState, draftAction, draftPending] = useActionState(
    saveAvailabilityDraftAction,
    undefined as ActionResult | undefined,
  );
  const [submitState, submitAction, submitPending] = useActionState(
    submitAvailabilityAction,
    undefined as ActionResult | undefined,
  );
  const [autoDraftState, autoDraftAction, autoDraftPending] = useActionState(
    saveAvailabilityDraftAction,
    undefined as ActionResult | undefined,
  );

  const pending = draftPending || submitPending;
  const formRef = useRef<HTMLFormElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(new Set<string>());
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);

  function queueDraft(itemId: string) {
    const offer = items.find((item) => item.id === itemId)?.offer;
    if (offer && offer.status !== "DRAFT") return;
    dirty.current.add(itemId);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    function autosave() {
      const form = formRef.current;
      if (!form) return;
      if (document.querySelector('#availability-form-submit [aria-busy="true"]')) {
        autosaveTimer.current = setTimeout(autosave, 350);
        return;
      }
      const data = new FormData(form);
      data.delete("requestItemId");
      for (const id of dirty.current) {
        if (data.get(`notAvailable:${id}`) === "true") continue;
        const qty = String(data.get(`quantityDeclared:${id}`) ?? "");
        const date = String(data.get(`availableDate:${id}`) ?? "");
        const amounts = data.getAll(`splitQuantity:${id}`);
        const dates = data.getAll(`splitDate:${id}`);
        const values = [{ quantity: qty, date }, ...amounts.map((quantity, i) => ({ quantity, date: dates[i] }))];
        if (availabilitySplitsSchema.safeParse(values).success) data.append("requestItemId", id);
      }
      if (!data.has("requestItemId")) return;
      for (const id of data.getAll("requestItemId")) dirty.current.delete(String(id));
      startTransition(() => autoDraftAction(data));
    }
    autosaveTimer.current = setTimeout(autosave, 1100);
  }

  function updateSplit(itemId: string, key: string, patch: Partial<AvailabilitySplit>) {
    setSplits((current) => ({
      ...current,
      [itemId]: current[itemId].map((row) => row.key === key ? { ...row, ...patch } : row),
    }));
    queueDraft(itemId);
  }
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
    setSplits((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!na[item.id]) {
          next[item.id] = prev[item.id].map((row, index) => index === 0 ? { ...row, date: bulkDate } : row);
        }
      }
      return next;
    });
    items.filter((item) => !na[item.id]).forEach((item) => queueDraft(item.id));
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        {hasExistingResponse ? (
          <AvailabilityResponseSummary items={items} />
        ) : null}
        <section
          className="flex flex-col gap-3 rounded-lg border p-4"
          aria-labelledby="availability-collapsed-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2
                id="availability-collapsed-heading"
                className="text-lg font-medium"
              >
                {unanswered.length > 0 ? "Finish your reply" : "Need to change?"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {unanswered.length > 0
                  ? `${unanswered.length} item${unanswered.length === 1 ? "" : "s"} still need an answer.`
                  : "Update quantity or delivery date. Agreed prices stay locked."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                buttonVariants({
                  className: "min-h-11 w-full shrink-0 sm:w-auto",
                }),
              )}
            >
              {unanswered.length > 0 ? "Continue reply" : "Edit availability"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const primarySubmitLabel = hasExistingResponse
    ? "Save Changes"
    : "Submit Response";
  const confirmSubmitLabel = hasExistingResponse
    ? "Confirm save"
    : "Confirm submit";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {hasExistingResponse ? "Edit availability" : "Your reply"}
        </h2>
        {collapseByDefault || unanswered.length === 0 ? (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setConfirmSubmit(false);
            }}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Done
          </button>
        ) : null}
      </div>

      {showBulk ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Same delivery date</span>
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
            Apply to all
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
      ) : null}

      {activeErrorState ? (
        <p role="alert" className="text-sm text-destructive">
          {activeErrorState.error}
        </p>
      ) : null}
      {(draftState?.ok || autoDraftState?.ok) && !submitPending ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
        >
          Draft saved. Use{" "}
          {primarySubmitLabel} when ready.
        </p>
      ) : null}
      {autoDraftState?.ok === false && !draftState?.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          Automatic draft save failed. Use Save draft to try again.
        </p>
      ) : null}

      <form id="availability-form" ref={formRef} className="flex flex-col gap-4" onSubmitCapture={() => {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      }}>
        <input type="hidden" name="supplierRequestId" value={supplierRequestId} />
        {items.map((item) => {
          const qtyError = fieldError(activeErrorState, `${item.id}:quantity`);
          const dateError = fieldError(activeErrorState, `${item.id}:date`);
          const priceError = fieldError(activeErrorState, `${item.id}:unitPrice`);
          const versionError = fieldError(activeErrorState, `${item.id}:version`);
          const liveReserve = isLiveReserve(item.offer);
          const expiredSubmittedLike =
            item.offer?.status === "EXPIRED" ||
            (item.offer?.status === "SUBMITTED" &&
              item.offer.reserveExpiresAt &&
              !liveReserve);
          const showNotes =
            notesOpen[item.id] || Boolean(item.offer?.notes?.trim());
          const rows = splits[item.id];
          const total = totalAvailability(rows);
          const exceedsRequest = (quantityUnits(total) ?? BigInt(0)) > (quantityUnits(item.quantityRequested) ?? BigInt(0));

          return (
            <div key={item.id} className="rounded-lg border border-border p-4">
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
                    : ""}
                  {item.product.sku ? ` · ${item.product.sku}` : ""}
                </p>
                {liveReserve ? (
                  <p
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(item.offer!.reserveExpiresAt)}
                  >
                    Reserved until{" "}
                    {formatShortDateTime(item.offer!.reserveExpiresAt)}.
                  </p>
                ) : null}
                {expiredSubmittedLike ? (
                  <p
                    className="text-xs text-muted-foreground"
                    title={
                      item.offer?.reserveExpiresAt
                        ? formatDateTime(item.offer.reserveExpiresAt)
                        : undefined
                    }
                  >
                    Previous reserve ended. Submit a new quantity to start a
                    fresh reserve.
                  </p>
                ) : null}
                {versionError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {versionError}
                  </p>
                ) : null}
              </div>


              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                {rows.map((row, index) => (
                  <div key={row.key} className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-2">
                    <label className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-sm font-medium">Available quantity{index > 0 ? " " + (index + 1) : ""}</span>
                      <input
                        id={"availability-quantity-" + item.id + "-" + row.key}
                        name={(index === 0 ? "quantityDeclared:" : "splitQuantity:") + item.id}
                        type="number" step="any" min="0" inputMode="decimal" autoComplete="off"
                        disabled={Boolean(na[item.id]) || pending}
                        value={row.quantity}
                        onChange={(event) => updateSplit(item.id, row.key, { quantity: event.target.value })}
                        aria-invalid={Boolean(qtyError)}
                        aria-label={"Available quantity for " + item.product.name + (index > 0 ? ", date " + (index + 1) : "")}
                        className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base disabled:opacity-60"
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-sm font-medium">Available date{index > 0 ? " " + (index + 1) : ""}</span>
                      <input
                        name={(index === 0 ? "availableDate:" : "splitDate:") + item.id}
                        type="date" disabled={Boolean(na[item.id]) || pending}
                        value={row.date}
                        onChange={(event) => updateSplit(item.id, row.key, { date: event.target.value })}
                        aria-invalid={Boolean(dateError)}
                        className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base disabled:opacity-60"
                      />
                    </label>
                    {rows.length > 1 && (
                      <button type="button" disabled={pending || Boolean(na[item.id])}
                        aria-label={"Remove date " + (index + 1) + " for " + item.product.name}
                        className="min-h-11 w-fit text-sm underline sm:col-span-2"
                        onClick={() => {
                          setSplits((current) => ({ ...current, [item.id]: rows.filter((entry) => entry.key !== row.key) }));
                          queueDraft(item.id);
                          requestAnimationFrame(() => document.getElementById("add-availability-" + item.id)?.focus());
                        }}>
                        Remove date {index + 1}
                      </button>
                    )}
                  </div>
                ))}
                {!na[item.id] && (
                  <div className="flex flex-wrap items-center gap-x-4 sm:col-span-2">
                    <button id={"add-availability-" + item.id} type="button"
                      disabled={pending || rows.length >= maxAvailabilitySplits}
                      className="min-h-11 text-sm font-medium underline"
                      onClick={() => {
                        const key = crypto.randomUUID();
                        setSplits((current) => ({ ...current, [item.id]: [...current[item.id], { key, quantity: "", date: "" }] }));
                        requestAnimationFrame(() => document.getElementById("availability-quantity-" + item.id + "-" + key)?.focus());
                      }}>
                      Add another date
                    </button>
                    <p className="text-sm" aria-live="polite">Total available: {total}</p>
                  </div>
                )}
                {!na[item.id] && exceedsRequest && (
                  <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
                    This is more than requested. The company must approve any extra quantity it orders.
                  </p>
                )}
                {(qtyError || dateError) && (
                  <p role="alert" className="text-sm text-destructive sm:col-span-2">{qtyError ?? dateError}</p>
                )}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-sm font-medium">Unit price (LKR)</span>
                  {isAgreedPriceAgreementStatus(
                    item.offer?.priceAgreement?.status,
                  ) ? (
                    <>
                      <input
                        type="hidden"
                        name={`unitPrice:${item.id}`}
                        value={item.offer!.priceAgreement!.unitPrice}
                      />
                      <p
                        className="flex min-h-11 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm font-medium tabular-nums"
                        aria-label={`Agreed unit price ${item.offer!.priceAgreement!.unitPrice} LKR`}
                      >
                        {item.offer!.priceAgreement!.unitPrice} LKR · agreed
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        name={`unitPrice:${item.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        autoComplete="off"
                        onInput={() => { editedPrices.current.add(item.id); queueDraft(item.id); }}
                        disabled={Boolean(na[item.id]) || pending}
                        defaultValue={editableUnitPriceDefault(item.offer)}
                        aria-invalid={Boolean(priceError)}
                        aria-label="Unit price in LKR"
                        className="min-h-11 rounded-lg border border-border bg-background px-3 text-base disabled:opacity-60"
                      />
                      {item.savedCataloguePrice && !pending && !na[item.id] ? (
                        <>
                          <button type="button" className="min-h-11 w-fit text-sm font-medium underline"
                            onClick={(event) => {
                              const form = event.currentTarget.form;
                              const price = form?.elements.namedItem(`unitPrice:${item.id}`);

                              const saved = item.savedCataloguePrice;
                              if (!(price instanceof HTMLInputElement) || !saved) return;
                              let message: string;
                              if (price.value || editedPrices.current.has(item.id)) {
                                message = "Your entered price was kept.";
                              } else if (saved.moq && !meetsCatalogueMoq(total, saved.moq)) {
                                message = `Enter at least ${saved.moq} available to use this saved price.`;
                              } else {
                                price.value = saved.unitPrice;
                                price.focus();
                                queueDraft(item.id);
                                message = "Saved price applied to this form.";
                              }
                              setSavedPriceFeedback((feedback) => ({ ...feedback, [item.id]: message }));
                            }}
                          >Use saved price</button>
                          {savedPriceFeedback[item.id] ? <p role="status" className="text-sm">{savedPriceFeedback[item.id]}</p> : null}
                        </>
                      ) : null}
                      {priceError ? (
                        <span role="alert" className="text-sm text-destructive">
                          {priceError}
                        </span>
                      ) : item.offer?.priceAgreement?.status ===
                        "COUNTER_PENDING" ? (
                        <span className="text-xs text-muted-foreground">
                          Your quote only — accept or revise the company
                          counteroffer above first.
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(na[item.id])}
                  disabled={pending}
                  onChange={(e) =>
                    setNa((prev) => ({ ...prev, [item.id]: e.target.checked }))
                  }
                  className="size-4"
                />
                Not available
              </label>

              {showNotes ? (
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Notes (optional)</span>
                  <input
                    name={`notes:${item.id}`}
                    defaultValue={item.offer?.notes ?? ""}
                    disabled={pending}
                    className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
                  />
                </label>
              ) : (
                <>
                  <input
                    type="hidden"
                    name={`notes:${item.id}`}
                    value={item.offer?.notes ?? ""}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setNotesOpen((prev) => ({ ...prev, [item.id]: true }))
                    }
                    className="mt-3 text-left text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Add note
                  </button>
                </>
              )}
            </div>
          );
        })}
      </form>

      <div id="availability-form-submit" className="border-t border-border pt-3 sm:border-0 sm:pt-0">
        <p className="mb-2 text-xs text-muted-foreground sm:mb-3">
          Save draft keeps work in progress. {primarySubmitLabel} sends your
          reply to the company.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="submit"
            form="availability-form"
            formAction={draftAction}
            disabled={pending || autoDraftPending}
            aria-busy={draftPending || autoDraftPending}
            className={cn(
              buttonVariants({
                variant: "outline",
                className: "min-h-11 w-full sm:w-auto",
              }),
            )}
          >
            {draftPending || autoDraftPending ? "Saving draft…" : "Save draft"}
          </button>
          {!confirmSubmit ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmSubmit(true)}
              className={cn(
                buttonVariants({ className: "min-h-11 w-full sm:w-auto" }),
              )}
            >
              {primarySubmitLabel}
            </button>
          ) : (
            <>
              <button
                type="submit"
                form="availability-form"
                formAction={submitAction}
                disabled={pending || autoDraftPending}
                aria-busy={submitPending}
                className={cn(
                  buttonVariants({ className: "min-h-11 w-full sm:w-auto" }),
                )}
              >
                {submitPending ? "Submitting…" : confirmSubmitLabel}
              </button>
              <button
                type="button"
                onClick={() => setConfirmSubmit(false)}
                disabled={pending}
                className={cn(
                  buttonVariants({
                    variant: "outline",
                    className: "min-h-11 w-full sm:w-auto",
                  }),
                )}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
