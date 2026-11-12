"use client";

import { useActionState, useState } from "react";

import {
  approveRegistrationAction,
  rejectRegistrationAction,
  type RegistrationActionResult,
} from "@/app/admin/suppliers/registration-actions";
import { buttonVariants } from "@/components/ui/button";
import type { SupplierRegistrationSource, SupplierStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

export function RegistrationReviewPanel({
  supplierId,
  status,
  registrationSource,
  rejectionReason,
}: {
  supplierId: string;
  status: SupplierStatus;
  registrationSource: SupplierRegistrationSource;
  rejectionReason: string | null;
}) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveRegistrationAction,
    undefined as RegistrationActionResult | undefined,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectRegistrationAction,
    undefined as RegistrationActionResult | undefined,
  );
  const [confirmReject, setConfirmReject] = useState(false);

  if (registrationSource !== "SELF") {
    return null;
  }

  if (status === "REJECTED") {
    return (
      <div className="rounded-lg border p-4 text-sm leading-6">
        <h2 className="text-base font-medium">Registration rejected</h2>
        <p className="mt-1 text-muted-foreground">
          This self-registration was rejected
          {rejectionReason ? `: ${rejectionReason}` : "."} This is distinct from
          ordinary supplier deactivation.
        </p>
      </div>
    );
  }

  if (status !== "PENDING_REVIEW") {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-medium">Self-registration review</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve to activate, or reject with a recorded reason. Rejection is
          not the same as deactivating an active supplier.
        </p>
      </div>

      {(approveState && !approveState.ok) || (rejectState && !rejectState.ok) ? (
        <p role="alert" className="text-sm text-destructive">
          {approveState && !approveState.ok
            ? approveState.error
            : rejectState && !rejectState.ok
              ? rejectState.error
              : null}
        </p>
      ) : null}

      {!confirmReject ? (
        <div className="flex flex-wrap gap-2">
          <form action={approveAction}>
            <input type="hidden" name="supplierId" value={supplierId} />
            <button
              type="submit"
              disabled={approvePending || rejectPending}
              className={cn(buttonVariants({ className: "min-h-11" }))}
            >
              {approvePending ? "Approving…" : "Approve registration"}
            </button>
          </form>
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
            onClick={() => setConfirmReject(true)}
          >
            Reject registration
          </button>
        </div>
      ) : (
        <form action={rejectAction} className="flex flex-col gap-3">
          <input type="hidden" name="supplierId" value={supplierId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Rejection reason</span>
            <textarea
              name="reason"
              required
              minLength={3}
              className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={rejectPending}
              className={cn(
                buttonVariants({
                  variant: "destructive",
                  className: "min-h-11",
                }),
              )}
            >
              {rejectPending ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
              onClick={() => setConfirmReject(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
