"use client";

import { useActionState, useMemo, useState } from "react";

import type { ActionResult } from "@/app/staff/osf-imports/actions";
import { buttonVariants } from "@/components/ui/button";
import type { OsfImportReviewModel } from "@/lib/osf-imports/queries";
import { cn } from "@/lib/utils";

type UnresolvedRow = OsfImportReviewModel["unresolvedCosmoSuppliers"][number];
type MappableSupplier = OsfImportReviewModel["mappableSuppliers"][number];

type Props = {
  importId: string;
  unresolved: UnresolvedRow[];
  mappableSuppliers: MappableSupplier[];
  canMap: boolean;
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function eligibilityLabel(
  supplier: MappableSupplier,
  brandIds: string[],
): string {
  if (supplier.status !== "ACTIVE") {
    return `Not ACTIVE (${supplier.status}) — will map as ineligible`;
  }
  if (supplier.supportsAllBrands) {
    return "ACTIVE · brand-eligible (All Brands)";
  }
  if (brandIds.length === 0) {
    return "ACTIVE · brand eligibility unknown until lines resolve";
  }
  const eligibleCount = brandIds.filter((id) =>
    supplier.brandIds.includes(id),
  ).length;
  if (eligibleCount === brandIds.length) {
    return "ACTIVE · brand-eligible for affected lines";
  }
  if (eligibleCount === 0) {
    return "ACTIVE · not brand-eligible for affected lines";
  }
  return `ACTIVE · brand-eligible for ${eligibleCount}/${brandIds.length} affected brands`;
}

function UnresolvedMapRow({
  importId,
  row,
  mappableSuppliers,
  canMap,
  action,
}: {
  importId: string;
  row: UnresolvedRow;
  mappableSuppliers: MappableSupplier[];
  canMap: boolean;
  action: Props["action"];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [portalSupplierId, setPortalSupplierId] = useState("");
  const [confirming, setConfirming] = useState(false);

  const selected = useMemo(
    () => mappableSuppliers.find((s) => s.id === portalSupplierId) ?? null,
    [mappableSuppliers, portalSupplierId],
  );

  const needsConfirmChange = Boolean(
    selected?.externalId && selected.externalId !== row.cosmoSupplierId,
  );

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium">{row.cosmoSupplierName}</p>
        <p className="text-sm text-muted-foreground">
          Cosmo ID: <span className="font-mono text-xs">{row.cosmoSupplierId}</span>
          {row.cosmoSupplierCode ? ` · Code: ${row.cosmoSupplierCode}` : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {row.suggestionCount} suggestion
          {row.suggestionCount === 1 ? "" : "s"} · qty{" "}
          {row.totalSuggestedQty} · status {row.mappingStatus.replaceAll("_", " ")}
        </p>
        <p className="text-xs text-muted-foreground">
          Lines: {row.lineKeys.join(", ")}
        </p>
      </div>

      {!canMap ? (
        <p className="text-sm text-muted-foreground">
          Mapping requires an admin. Status is read-only.
        </p>
      ) : !confirming ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Portal supplier</span>
            <select
              className={fieldClass}
              value={portalSupplierId}
              onChange={(e) => setPortalSupplierId(e.target.value)}
            >
              <option value="">Select supplier…</option>
              {mappableSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.externalId ? ` (mapped: ${s.externalId})` : ""} — {s.status}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <p className="text-sm text-muted-foreground" role="status">
              {eligibilityLabel(selected, row.brandIds)}
              {selected.externalId &&
              selected.externalId !== row.cosmoSupplierId
                ? ` · Currently mapped to a different Cosmo ID (${selected.externalId})`
                : null}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!portalSupplierId || pending}
            className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
            onClick={() => setConfirming(true)}
          >
            Map Cosmo supplier…
          </button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="cosmoSupplierId" value={row.cosmoSupplierId} />
          <input type="hidden" name="portalSupplierId" value={portalSupplierId} />
          <input
            type="hidden"
            name="expectedPortalExternalId"
            value={selected?.externalId ?? ""}
          />
          {needsConfirmChange ? (
            <input type="hidden" name="confirmChange" value="true" />
          ) : null}
          <p className="text-sm" role="status">
            Map Cosmo “{row.cosmoSupplierName}” ({row.cosmoSupplierId}) to Portal
            supplier “{selected?.name}”? This never sends supplier requests.
            {needsConfirmChange
              ? ` This replaces existing Cosmo mapping ${selected?.externalId}.`
              : null}
          </p>
          {state && !state.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className={cn(buttonVariants({ className: "min-h-11" }))}
            >
              {pending ? "Saving…" : "Confirm mapping"}
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

      {state?.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          Mapping saved. Suggestions were re-evaluated.
        </p>
      ) : null}
      {state && !state.ok && !confirming ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}

export function OsfUnresolvedCosmoMapping({
  importId,
  unresolved,
  mappableSuppliers,
  canMap,
  action,
}: Props) {
  if (unresolved.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Unresolved Cosmo supplier suggestions"
    >
      <div>
        <h2 className="text-lg font-medium">Unresolved Cosmo suppliers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Explicitly map Cosmo Supplier.id to an existing Portal supplier.
          Mapping never matches by name and never sends availability requests.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {unresolved.map((row) => (
          <UnresolvedMapRow
            key={row.cosmoSupplierId}
            importId={importId}
            row={row}
            mappableSuppliers={mappableSuppliers}
            canMap={canMap}
            action={action}
          />
        ))}
      </ul>
    </section>
  );
}
