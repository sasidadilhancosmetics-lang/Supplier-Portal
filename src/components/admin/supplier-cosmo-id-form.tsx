"use client";

import { useActionState, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { ActionResult } from "@/app/admin/suppliers/actions";
import { cn } from "@/lib/utils";

type SupplierCosmoIdFormProps = {
  supplierId: string;
  currentExternalId: string | null;
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SupplierCosmoIdForm({
  supplierId,
  currentExternalId,
  action,
}: SupplierCosmoIdFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [draft, setDraft] = useState(currentExternalId ?? "");
  const [confirming, setConfirming] = useState(false);

  const normalizedDraft = draft.trim();
  const normalizedCurrent = (currentExternalId ?? "").trim();
  const isClearing =
    normalizedCurrent.length > 0 && normalizedDraft.length === 0;
  const isChanging =
    normalizedCurrent.length > 0 &&
    normalizedDraft.length > 0 &&
    normalizedDraft !== normalizedCurrent;
  const needsConfirm = isClearing || isChanging;
  const isUnchanged = normalizedDraft === normalizedCurrent;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-medium">Cosmo OS Supplier ID</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {normalizedCurrent
            ? `Currently mapped to: ${normalizedCurrent}`
            : "Optional. Paste the Cosmo OS Supplier.id (cuid). Never match by name."}
        </p>
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cosmo mapping saved. Related import suggestions were re-evaluated.
        </p>
      ) : null}

      {!confirming ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Cosmo OS Supplier ID</span>
            <input
              className={fieldClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. clxyz…"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-xs text-muted-foreground">
              Company-scoped unique identity. Clear the field to remove the
              mapping.
            </span>
          </label>
          <button
            type="button"
            disabled={pending || isUnchanged}
            className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
            onClick={() => {
              if (needsConfirm) setConfirming(true);
              else setConfirming(true); // show confirm panel even for first set as "Save"
            }}
          >
            {isUnchanged ? "No changes" : "Save mapping…"}
          </button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="supplierId" value={supplierId} />
          <input
            type="hidden"
            name="expectedExternalId"
            value={currentExternalId ?? ""}
          />
          <input type="hidden" name="externalId" value={normalizedDraft} />
          {needsConfirm ? (
            <input type="hidden" name="confirmChange" value="true" />
          ) : null}
          <p className="text-sm" role="status">
            {isClearing
              ? `Clear Cosmo mapping “${normalizedCurrent}”? Related suggestions will become unresolved.`
              : isChanging
                ? `Change Cosmo mapping from “${normalizedCurrent}” to “${normalizedDraft}”?`
                : `Map this supplier to Cosmo OS Supplier ID “${normalizedDraft}”?`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || isUnchanged}
              className={cn(
                buttonVariants({
                  variant: isClearing ? "destructive" : "default",
                  className: "min-h-11",
                }),
              )}
            >
              {pending ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
