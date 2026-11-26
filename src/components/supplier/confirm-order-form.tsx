"use client";

import { useActionState, useState } from "react";

import {
  confirmPurchaseOrderAction,
  type ConfirmOrderActionResult,
} from "@/app/supplier/orders/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ConfirmOrderForm({
  purchaseOrderId,
  orderNumber,
}: {
  purchaseOrderId: string;
  orderNumber: string;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, action, pending] = useActionState(
    confirmPurchaseOrderAction,
    undefined as ConfirmOrderActionResult | undefined,
  );

  const showDialog = dialogOpen && !state?.ok;

  return (
    <div className="flex flex-col gap-3">
      {state?.ok ? (
        <p
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground"
        >
          Order {state.orderNumber} confirmed.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      {!state?.ok ? (
        <>
          <button
            type="button"
            className={cn(buttonVariants({ className: "min-h-11 w-full sm:w-fit" }))}
            onClick={() => setDialogOpen(true)}
            disabled={pending}
          >
            Confirm entire order
          </button>

          {showDialog ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-order-title"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
            >
              <div className="brand-logo-enter w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
                <h2
                  id="confirm-order-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  Confirm order {orderNumber}?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This confirms the entire purchase order. Quantities and delivery
                  dates will not change.
                </p>
                <form action={action} className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
                  <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
                  <button
                    type="button"
                    className={cn(
                      buttonVariants({
                        variant: "outline",
                        className: "min-h-11",
                      }),
                    )}
                    onClick={() => setDialogOpen(false)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={cn(buttonVariants({ className: "min-h-11" }))}
                    disabled={pending}
                  >
                    {pending ? "Confirming…" : "Confirm entire order"}
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
