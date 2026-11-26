"use client";

import { useActionState, useState } from "react";

import {
  cancelPurchaseOrderAction,
  type CancelOrderActionResult,
} from "@/app/supplier/orders/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CancelOrderForm({
  purchaseOrderId,
  orderNumber,
}: {
  purchaseOrderId: string;
  orderNumber: string;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(
    cancelPurchaseOrderAction,
    undefined as CancelOrderActionResult | undefined,
  );

  const showDialog = dialogOpen && !state?.ok;

  return (
    <div className="flex flex-col gap-3">
      {state?.ok ? (
        <p
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground"
        >
          Order {state.orderNumber} cancelled.
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
            className={cn(
              buttonVariants({
                variant: "outline",
                className: "min-h-11 w-full border-destructive/40 text-destructive sm:w-fit",
              }),
            )}
            onClick={() => setDialogOpen(true)}
            disabled={pending}
          >
            Cancel order
          </button>

          {showDialog ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-order-title"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
            >
              <div className="brand-logo-enter w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
                <h2
                  id="cancel-order-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  Cancel order {orderNumber}?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This cancels all remaining undelivered quantity and releases
                  allocations. Ordered quantities are preserved for history.
                </p>
                <form action={action} className="mt-4 flex flex-col gap-4">
                  <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
                  <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">
                      Cancellation reason{" "}
                      <span className="text-destructive">*</span>
                    </span>
                    <textarea
                      name="cancelReason"
                      required
                      maxLength={500}
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      placeholder="Explain why this order is being cancelled"
                    />
                    <span className="text-xs text-muted-foreground">
                      {reason.length}/500
                    </span>
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
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
                      Keep order
                    </button>
                    <button
                      type="submit"
                      className={cn(
                        buttonVariants({
                          className:
                            "min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90",
                        }),
                      )}
                      disabled={pending || reason.trim().length === 0}
                    >
                      {pending ? "Cancelling…" : "Confirm cancellation"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
