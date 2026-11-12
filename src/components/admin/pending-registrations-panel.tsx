"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  approveRegistrationAction,
  rejectRegistrationAction,
  type RegistrationActionResult,
} from "@/app/admin/suppliers/registration-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PendingRow = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  createdAt: Date | string;
  applicants: { id: string; email: string; name: string | null }[];
  brands: { id: string; name: string }[];
  supportsAllBrands: boolean;
};

function formatWhen(value: Date | string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PendingRegistrationsPanel({
  registrations,
}: {
  registrations: PendingRow[];
}) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveRegistrationAction,
    undefined as RegistrationActionResult | undefined,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectRegistrationAction,
    undefined as RegistrationActionResult | undefined,
  );
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  if (registrations.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Pending supplier registrations</h2>
        <p className="text-sm text-muted-foreground">
          No self-registrations waiting for review.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Pending supplier registrations</h2>
        <p className="text-sm text-muted-foreground">
          Self-registered companies awaiting approve or reject. Rejection
          requires a reason and is distinct from deactivating an active
          supplier.
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

      <ul className="flex flex-col gap-4">
        {registrations.map((row) => (
          <li key={row.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Link
                  href={`/admin/suppliers/${row.id}`}
                  className="text-base font-medium underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Submitted {formatWhen(row.createdAt)}
                  {row.contactName ? ` · ${row.contactName}` : ""}
                  {row.contactEmail ? ` · ${row.contactEmail}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  Brands:{" "}
                  {row.supportsAllBrands
                    ? "All brands"
                    : row.brands.length > 0
                      ? row.brands.map((b) => b.name).join(", ")
                      : "None selected"}
                </p>
                {row.applicants[0] ? (
                  <p className="text-sm text-muted-foreground">
                    Applicant: {row.applicants[0].email}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={approveAction}>
                  <input type="hidden" name="supplierId" value={row.id} />
                  <button
                    type="submit"
                    disabled={approvePending || rejectPending}
                    className={cn(buttonVariants({ className: "min-h-11" }))}
                  >
                    Approve
                  </button>
                </form>
                <button
                  type="button"
                  disabled={approvePending || rejectPending}
                  className={cn(
                    buttonVariants({
                      variant: "outline",
                      className: "min-h-11",
                    }),
                  )}
                  onClick={() =>
                    setRejectingId(rejectingId === row.id ? null : row.id)
                  }
                >
                  Reject
                </button>
              </div>
            </div>

            {rejectingId === row.id ? (
              <form action={rejectAction} className="mt-4 flex flex-col gap-3">
                <input type="hidden" name="supplierId" value={row.id} />
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Rejection reason</span>
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Explain why this registration is rejected"
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
                      buttonVariants({
                        variant: "outline",
                        className: "min-h-11",
                      }),
                    )}
                    onClick={() => setRejectingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
