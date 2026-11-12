"use client";

import { useActionState, useState } from "react";

import {
  distributeRequirementAction,
  type ActionResult,
} from "@/app/staff/requirements/[id]/distribute/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SupplierRow = {
  id: string;
  name: string;
  status: string;
  supportsAllBrands: boolean;
  alreadyRequested: boolean;
  existingStatus: string | null;
};

export function DistributeForm({
  requirementId,
  suppliers,
}: {
  requirementId: string;
  suppliers: SupplierRow[];
}) {
  const [mode, setMode] = useState<"ALL_MATCHING" | "SELECTED">("ALL_MATCHING");
  const [state, formAction, pending] = useActionState(
    distributeRequirementAction,
    undefined as ActionResult | undefined,
  );

  const eligible = suppliers.filter(
    (s) => s.status === "ACTIVE" && !s.alreadyRequested,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="requirementId" value={requirementId} />
      <input type="hidden" name="mode" value={mode} />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Recipients</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="modeUi"
            checked={mode === "ALL_MATCHING"}
            onChange={() => setMode("ALL_MATCHING")}
          />
          Send to all matching suppliers ({eligible.length} eligible)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="modeUi"
            checked={mode === "SELECTED"}
            onChange={() => setMode("SELECTED")}
          />
          Select specific suppliers
        </label>
      </fieldset>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              {mode === "SELECTED" ? (
                <th className="px-3 py-3 font-medium">Select</th>
              ) : null}
              <th className="px-3 py-3 font-medium">Supplier</th>
              <th className="px-3 py-3 font-medium">Match</th>
              <th className="px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => {
              const disabled =
                supplier.status !== "ACTIVE" || supplier.alreadyRequested;
              return (
                <tr key={supplier.id} className="border-b last:border-0">
                  {mode === "SELECTED" ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        name="supplierIds"
                        value={supplier.id}
                        disabled={disabled}
                        className="size-4"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3 font-medium">{supplier.name}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {supplier.supportsAllBrands ? "All brands" : "Brand member"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {supplier.alreadyRequested
                      ? `Already requested (${supplier.existingStatus})`
                      : supplier.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="flex max-w-sm flex-col gap-1.5">
        <span className="text-sm font-medium">Response deadline (optional)</span>
        <input
          type="datetime-local"
          name="responseDeadline"
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={pending || eligible.length === 0}
        className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
      >
        {pending ? "Sending…" : "Send requests"}
      </button>
    </form>
  );
}
