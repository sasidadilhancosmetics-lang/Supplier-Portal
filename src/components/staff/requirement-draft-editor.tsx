"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/app/staff/requirements/actions";
import {
  addRequirementItemAction,
  confirmRequirementAction,
  removeRequirementItemAction,
  updateRequirementItemAction,
  updateRequirementMetaAction,
} from "@/app/staff/requirements/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  priorityStatus: string;
  masterStatus: string;
};

type ItemRow = {
  id: string;
  quantityPlanned: string;
  notes: string | null;
  product: {
    id: string;
    name: string;
    sku: string | null;
    erpItemId: string | null;
    priorityStatus: string;
    masterStatus: string;
    unitOfMeasure: string | null;
  };
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";

export function RequirementDraftEditor({
  requirementId,
  title,
  notes,
  items,
  products,
}: {
  requirementId: string;
  title: string | null;
  notes: string | null;
  items: ItemRow[];
  products: ProductOption[];
}) {
  const [metaState, metaAction, metaPending] = useActionState(
    updateRequirementMetaAction,
    undefined as ActionResult | undefined,
  );
  const [addState, addAction, addPending] = useActionState(
    addRequirementItemAction,
    undefined as ActionResult | undefined,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmRequirementAction,
    undefined as ActionResult | undefined,
  );

  const availableProducts = products.filter(
    (product) => !items.some((item) => item.product.id === product.id),
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Details</h2>
        <form action={metaAction} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="requirementId" value={requirementId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Title</span>
            <input
              className={fieldClass}
              name="title"
              defaultValue={title ?? ""}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Notes</span>
            <textarea
              className={cn(fieldClass, "min-h-24 py-2")}
              name="notes"
              defaultValue={notes ?? ""}
            />
          </label>
          {metaState && !metaState.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {metaState.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={metaPending}
            className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
          >
            {metaPending ? "Saving…" : "Save details"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Line items</h2>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No products yet. Add at least one before confirming.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{item.product.name}</p>
                  <p className="text-sm text-muted-foreground">
                    SKU {item.product.sku ?? "—"} · ERP{" "}
                    {item.product.erpItemId ?? "—"} ·{" "}
                    {item.product.priorityStatus} · {item.product.masterStatus}
                  </p>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <form
                    action={updateRequirementItemAction}
                    className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <input
                      type="hidden"
                      name="requirementId"
                      value={requirementId}
                    />
                    <input type="hidden" name="itemId" value={item.id} />
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Quantity</span>
                      <input
                        className={fieldClass}
                        name="quantityPlanned"
                        type="number"
                        step="any"
                        min="0.0001"
                        required
                        defaultValue={item.quantityPlanned}
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-sm font-medium">Notes</span>
                      <input
                        className={fieldClass}
                        name="notes"
                        defaultValue={item.notes ?? ""}
                      />
                    </label>
                    <button
                      type="submit"
                      className={cn(
                        buttonVariants({
                          variant: "outline",
                          className: "min-h-11",
                        }),
                      )}
                    >
                      Update
                    </button>
                  </form>
                  <form action={removeRequirementItemAction}>
                    <input
                      type="hidden"
                      name="requirementId"
                      value={requirementId}
                    />
                    <input type="hidden" name="itemId" value={item.id} />
                    <button
                      type="submit"
                      className={cn(
                        buttonVariants({
                          variant: "destructive",
                          className: "min-h-11",
                        }),
                      )}
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          action={addAction}
          className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="requirementId" value={requirementId} />
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Add product</span>
            <select
              className={fieldClass}
              name="productId"
              required
              defaultValue=""
              disabled={availableProducts.length === 0}
            >
              <option value="" disabled>
                {availableProducts.length === 0
                  ? "No more products for this brand"
                  : "Select product"}
              </option>
              {availableProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.sku ? ` (${product.sku})` : ""} ·{" "}
                  {product.priorityStatus}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Quantity</span>
            <input
              className={fieldClass}
              name="quantityPlanned"
              type="number"
              step="any"
              min="0.0001"
              required
              defaultValue="1"
            />
          </label>
          <button
            type="submit"
            disabled={addPending || availableProducts.length === 0}
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            {addPending ? "Adding…" : "Add"}
          </button>
          {addState && !addState.ok ? (
            <p role="alert" className="w-full text-sm text-destructive">
              {addState.error}
            </p>
          ) : null}
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Confirm requirement</h2>
        <p className="text-sm text-muted-foreground">
          Confirmation is permanent for Stage 5A editing. Supplier request
          distribution is not started yet.
        </p>
        {confirmState && !confirmState.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {confirmState.error}
          </p>
        ) : null}
        {confirmState?.ok ? (
          <p role="status" className="text-sm">
            Confirmed.
          </p>
        ) : null}
        <form action={confirmAction}>
          <input type="hidden" name="requirementId" value={requirementId} />
          <button
            type="submit"
            disabled={confirmPending || items.length === 0}
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            {confirmPending ? "Confirming…" : "Confirm draft"}
          </button>
        </form>
      </section>
    </div>
  );
}
