"use client";

import { useActionState, useMemo, useState } from "react";

import {
  allocatePurchaseOrderAction,
  type AllocateActionResult,
} from "@/app/staff/orders/actions";
import { buttonVariants } from "@/components/ui/button";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import {
  allocatePreviewLineTotal,
  allocatePreviewOrderTotal,
  formatOrderMoney,
} from "@/lib/orders/order-pricing";
import { cn } from "@/lib/utils";
import { quantityUnits } from "@/lib/requests/availability-splits";

type Line = {
  offerId: string;
  productId?: string;
  productName: string;
  productSku: string | null;
  quantityPlanned: string | null;
  remainingPlan?: string | null;
  quantityDeclared: string;
  quantityRequested?: string;
  splitDate?: string;
  splitQuantity?: string;
  quantityOrderedActive: string;
  availableDate: Date | string | null;
  reserveExpiresAt: Date | string | null;
  status: string;
  remainingAllocatable?: string;
  agreedUnitPrice?: string | null;
  priceAgreementStatus?: string | null;
  priceIsAgreed?: boolean;
};

function rowKey(line: Line) {
  return line.splitDate ? line.offerId + ":" + line.splitDate : line.offerId;
}

export function AllocateForm({
  supplierId,
  supplierName,
  requestId,
  lines,
}: {
  supplierId: string;
  supplierName: string;
  requestId: string;
  lines: Line[];
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [rowKey(line), ""])),
  );
  const [state, action, pending] = useActionState(
    allocatePurchaseOrderAction,
    undefined as AllocateActionResult | undefined,
  );

  const needsAbovePlanHint = useMemo(() => {
    const selectedByOffer = new Map<string, bigint>();
    return lines.some((line) => {
      const q = quantityUnits(qtys[rowKey(line)] ?? "") ?? BigInt(0);
      if (q === BigInt(0)) return false;
      const total = (selectedByOffer.get(line.offerId) ?? BigInt(0)) + q;
      selectedByOffer.set(line.offerId, total);
      const ordered = quantityUnits(line.quantityOrderedActive) ?? BigInt(0);
      const requested = quantityUnits(line.quantityRequested ?? line.quantityDeclared) ?? BigInt(0);
      const remPlan = quantityUnits(line.remainingPlan ?? line.quantityPlanned ?? "0") ?? BigInt(0);
      return total > remPlan || total + ordered > requested;
    });
  }, [lines, qtys]);

  const linePreviews = useMemo(() => {
    return lines.map((line) => {
      const total = allocatePreviewLineTotal({
        quantityInput: qtys[rowKey(line)],
        agreedUnitPrice: line.priceIsAgreed ? line.agreedUnitPrice : null,
      });
      return {
        key: rowKey(line),
        lineTotal: total,
        lineTotalLabel: total ? formatOrderMoney(total, "LKR") : "—",
      };
    });
  }, [lines, qtys]);

  const orderPreview = useMemo(() => {
    const total = allocatePreviewOrderTotal(
      linePreviews.map((p) => p.lineTotal),
    );
    return {
      total,
      totalLabel: total ? formatOrderMoney(total, "LKR") : "—",
    };
  }, [linePreviews]);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="requestId" value={requestId} />

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Allocate from {supplierName}</h2>
        <p className="text-sm text-muted-foreground">
          Enter quantities against submitted offers with an agreed price only.
          Unconfirmed quotes are not copied onto the purchase order. Line totals
          below are a preview — the server recalculates on create.
        </p>
      </div>

      {state && !state.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 font-medium">Agreed price</th>
              <th className="px-3 py-3 font-medium">Declared</th>
              <th className="px-3 py-3 font-medium">Ordered</th>
              <th className="px-3 py-3 font-medium">Remaining</th>
              <th className="px-3 py-3 font-medium">Uncovered plan</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Reserve</th>
              <th className="px-3 py-3 font-medium">Allocate qty</th>
              <th className="px-3 py-3 font-medium">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const preview = linePreviews.find(
                (p) => p.key === rowKey(line),
              );
              return (
                <tr key={rowKey(line)} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{line.productName}</div>
                    <div className="text-muted-foreground">
                      {line.productSku ?? "—"} · {line.status}
                    </div>
                    <input
                      type="hidden"
                      name="availabilityOfferId"
                      value={line.offerId}
                    />
                    <input type="hidden" name="splitDate" value={line.splitDate ?? ""} />
                    <input type="hidden" name="allocationRowKey" value={rowKey(line)} />
                  </td>
                  <td className="px-3 py-3">
                    {line.priceIsAgreed && line.agreedUnitPrice ? (
                      <span>{line.agreedUnitPrice} LKR</span>
                    ) : (
                      <span className="text-destructive">
                        Not agreed
                        {line.priceAgreementStatus
                          ? ` (${line.priceAgreementStatus})`
                          : ""}
                        {line.productId ? (
                          <>
                            {" · "}
                            <a
                              href={`/staff/offers/${line.offerId}/negotiate`}
                              className="underline underline-offset-2"
                            >
                              Negotiate
                            </a>
                          </>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {line.splitQuantity ? line.splitQuantity + " on this date" : line.quantityDeclared}
                    <div className="text-xs text-muted-foreground">
                      {line.splitQuantity && <>Total offered {line.quantityDeclared} · </>}
                      Requested {line.quantityRequested ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-3">{line.quantityOrderedActive}</td>
                  <td className="px-3 py-3">
                    {line.remainingAllocatable ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {line.remainingPlan ?? line.quantityPlanned ?? "—"}
                    {line.quantityPlanned ? (
                      <div className="text-xs text-muted-foreground">
                        Planned {line.quantityPlanned}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatCalendarDate(line.availableDate)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(line.reserveExpiresAt)}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      name={"quantity:" + rowKey(line)}
                      inputMode="decimal"
                      value={qtys[rowKey(line)] ?? ""}
                      onChange={(e) =>
                        setQtys((prev) => ({
                          ...prev,
                          [rowKey(line)]: e.target.value,
                        }))
                      }
                      disabled={pending || !line.priceIsAgreed}
                      className="min-h-11 w-28 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
                      aria-label={`Quantity for ${line.productName}${line.splitDate ? " on " + line.splitDate : ""}`}
                    />
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {preview?.lineTotalLabel ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 px-4 py-3"
        aria-live="polite"
      >
        <p className="text-sm font-medium">Estimated order total</p>
        <p className="text-lg font-semibold tabular-nums">
          {orderPreview.totalLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          Preview only. Final totals use server-validated quantities and agreed
          prices.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <legend className="px-1 text-sm font-medium">Approve extra quantity</legend>
        <p className="text-sm text-muted-foreground">
          Required when ordering above the supplier request or remaining plan.
          {needsAbovePlanHint
            ? " Current inputs look above remaining plan."
            : null}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="abovePlanAcknowledged" />
          I approve ordering above the requested quantity or remaining plan
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Reason</span>
          <textarea
            name="abovePlanReason"
            rows={2}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
      >
        {pending ? "Creating order…" : "Create purchase order"}
      </button>
    </form>
  );
}
