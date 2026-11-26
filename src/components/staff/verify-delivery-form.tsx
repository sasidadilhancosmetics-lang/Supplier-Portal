"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import {
  rejectDeliveryAction,
  verifyDeliveryAction,
  type RejectDeliveryActionResult,
  type VerifyDeliveryActionResult,
} from "@/app/staff/deliveries/actions";
import { buttonVariants } from "@/components/ui/button";
import { todayCalendarDateInPortalTz } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Line = {
  deliveryItemId: string;
  productName: string;
  productSku: string | null;
  quantitySubmitted: string;
  quantityOrdered: string;
  quantityVerifiedReceived: string;
};

export function VerifyDeliveryForm({
  deliveryId,
  lines,
  requiresReceivedAt = false,
  plannedLabel = "Supplier submitted",
}: {
  deliveryId: string;
  lines: Line[];
  requiresReceivedAt?: boolean;
  plannedLabel?: string;
}) {
  const router = useRouter();
  const [verifyKey] = useState(() => crypto.randomUUID());
  const [rejectKey] = useState(() => crypto.randomUUID());
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.deliveryItemId, ""])),
  );
  const maxReceiptDate = todayCalendarDateInPortalTz();

  const [verifyState, verifyAction, verifyPending] = useActionState(
    async (
      prev: VerifyDeliveryActionResult | undefined,
      formData: FormData,
    ) => {
      const result = await verifyDeliveryAction(prev, formData);
      if (result.ok) {
        router.refresh();
      }
      return result;
    },
    undefined as VerifyDeliveryActionResult | undefined,
  );

  const [rejectState, rejectAction, rejectPending] = useActionState(
    async (
      prev: RejectDeliveryActionResult | undefined,
      formData: FormData,
    ) => {
      const result = await rejectDeliveryAction(prev, formData);
      if (result.ok) {
        router.refresh();
      }
      return result;
    },
    undefined as RejectDeliveryActionResult | undefined,
  );

  const pending = verifyPending || rejectPending;
  const error =
    (verifyState && !verifyState.ok ? verifyState.message : null) ||
    (rejectState && !rejectState.ok ? rejectState.message : null);

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {verifyState?.ok ? (
        <p className="text-sm text-muted-foreground" role="status">
          Receipt verified
          {verifyState.hasDiscrepancy ? " with discrepancy notes" : ""}.
          {verifyState.grnId ? " GRN issued." : ""}
        </p>
      ) : null}

      <form action={verifyAction} className="flex flex-col gap-6">
        <input type="hidden" name="idempotencyKey" value={verifyKey} />
        <input type="hidden" name="deliveryId" value={deliveryId} />

        <p className="text-sm text-muted-foreground">
          Enter the actual quantity received for each line. {plannedLabel}{" "}
          amounts are shown for reference only and are not assumed.
        </p>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Actual receipt date</span>
          <input
            type="date"
            name="receivedAt"
            required={requiresReceivedAt}
            max={maxReceiptDate}
            disabled={pending}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            Physical receipt date — today or earlier (Asia/Colombo).
          </span>
          {verifyState &&
          !verifyState.ok &&
          verifyState.fieldErrors?.receivedAt ? (
            <span className="text-xs text-destructive">
              {verifyState.fieldErrors.receivedAt}
            </span>
          ) : null}
        </label>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Ordered</th>
                <th className="px-3 py-3 font-medium">Already verified</th>
                <th className="px-3 py-3 font-medium">{plannedLabel}</th>
                <th className="px-3 py-3 font-medium">Received now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.deliveryItemId} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{line.productName}</div>
                    <div className="text-muted-foreground">
                      {line.productSku ?? "—"}
                    </div>
                    <input
                      type="hidden"
                      name="deliveryItemId"
                      value={line.deliveryItemId}
                    />
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {line.quantityOrdered}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {line.quantityVerifiedReceived}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {line.quantitySubmitted}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      name="quantityReceived"
                      inputMode="decimal"
                      value={received[line.deliveryItemId] ?? ""}
                      onChange={(e) =>
                        setReceived((prev) => ({
                          ...prev,
                          [line.deliveryItemId]: e.target.value,
                        }))
                      }
                      disabled={pending}
                      required
                      placeholder="Enter qty"
                      className="min-h-11 w-28 rounded-lg border border-border bg-background px-3 text-sm"
                      aria-label={`Actual received quantity for ${line.productName}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Discrepancy notes (required if received differs or is zero)
          </span>
          <textarea
            name="discrepancyNotes"
            rows={3}
            disabled={pending}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
        >
          {verifyPending ? "Verifying…" : "Verify & issue GRN"}
        </button>
      </form>

      <form
        action={rejectAction}
        className="flex flex-col gap-4 rounded-lg border border-border p-4"
      >
        <input type="hidden" name="idempotencyKey" value={rejectKey} />
        <input type="hidden" name="deliveryId" value={deliveryId} />
        <h3 className="text-base font-medium">Flag discrepancy (reject hold)</h3>
        <p className="text-sm text-muted-foreground">
          Rejects the schedule or submission without counting received stock.
          Quantity holds are released so the supplier can reschedule.
        </p>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Discrepancy notes</span>
          <textarea
            name="discrepancyNotes"
            rows={2}
            required
            disabled={pending}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            buttonVariants({
              variant: "outline",
              className: "min-h-11 w-fit",
            }),
          )}
        >
          {rejectPending ? "Flagging…" : "Flag discrepancy"}
        </button>
      </form>
    </div>
  );
}
