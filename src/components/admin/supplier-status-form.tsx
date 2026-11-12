"use client";

import { useActionState, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { ActionResult } from "@/app/admin/suppliers/actions";
import type { SupplierStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

type SupplierStatusFormProps = {
  supplierId: string;
  currentStatus: SupplierStatus;
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
};

export function SupplierStatusForm({
  supplierId,
  currentStatus,
  action,
}: SupplierStatusFormProps) {
  const [confirming, setConfirming] = useState<SupplierStatus | null>(null);
  const [state, formAction, pending] = useActionState(action, undefined);

  // Ordinary activate/deactivate only. Registration reject uses a dedicated form.
  const nextStatus: SupplierStatus | null =
    currentStatus === "ACTIVE"
      ? "INACTIVE"
      : currentStatus === "INACTIVE" || currentStatus === "PENDING_REVIEW"
        ? "ACTIVE"
        : currentStatus === "REJECTED"
          ? "ACTIVE"
          : null;

  if (!nextStatus) {
    return null;
  }

  const label =
    nextStatus === "ACTIVE" ? "Activate supplier" : "Deactivate supplier";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-medium">Status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Suppliers are never hard-deleted. Deactivation blocks supplier portal
          access.
        </p>
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {confirming !== nextStatus ? (
        <button
          type="button"
          className={cn(
            buttonVariants({
              variant: nextStatus === "INACTIVE" ? "destructive" : "default",
              className: "min-h-11 w-fit",
            }),
          )}
          onClick={() => setConfirming(nextStatus)}
        >
          {label}
        </button>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="supplierId" value={supplierId} />
          <input type="hidden" name="status" value={nextStatus} />
          <p className="w-full text-sm">
            Confirm {nextStatus === "ACTIVE" ? "activation" : "deactivation"}?
          </p>
          <button
            type="submit"
            disabled={pending}
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            {pending ? "Updating…" : "Confirm"}
          </button>
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
            onClick={() => setConfirming(null)}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
