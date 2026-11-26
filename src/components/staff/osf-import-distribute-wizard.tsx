"use client";

import { useActionState, useMemo, useState } from "react";

import {
  distributeOsfImportAction,
  type DistributeActionResult,
} from "@/app/staff/osf-imports/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WizardItem = {
  id: string;
  quantityPlanned: string;
  product: {
    id: string;
    name: string;
    sku: string | null;
    priorityStatus: string;
  };
};

type WizardSupplier = {
  id: string;
  name: string;
  status: string;
  supportsAllBrands: boolean;
  alreadyRequested: boolean;
  existingStatus: string | null;
};

type WizardSuggestion = {
  suggestionId: string;
  requirementItemId: string;
  lineKey: string;
  cosmoSupplierId: string;
  cosmoSupplierCode: string | null;
  cosmoSupplierName: string;
  suggestedRequestQty: string;
  supplierId: string | null;
  mappingStatus: string;
  overLineQty: boolean;
};

type WizardBrand = {
  requirementId: string;
  brandId: string;
  brandName: string;
  title: string | null;
  ledgerStatus: string | null;
  lastError: string | null;
  hasSuggestions?: boolean;
  prefillSupplierIds?: string[];
  suggestions?: WizardSuggestion[];
  items: WizardItem[];
  suppliers: WizardSupplier[];
};

type BrandMode = "ALL_MATCHING" | "SELECTED";

/** Per supplier+item: omitted/empty = ignore that item for the supplier. */
type SupplierItemQty = Record<
  string,
  Record<string, Record<string, string>>
>;

function outcomeLabel(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "Sent";
    case "ALREADY_SUCCEEDED":
      return "Already sent";
    case "SKIPPED_ALREADY_REQUESTED":
      return "Skipped — already requested";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function outcomeTone(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "text-[color:var(--primary)]";
    case "ALREADY_SUCCEEDED":
      return "text-muted-foreground";
    case "SKIPPED_ALREADY_REQUESTED":
      return "text-amber-400";
    case "FAILED":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function buildInitialSupplierItemQty(
  brands: WizardBrand[],
): SupplierItemQty {
  const next: SupplierItemQty = {};
  for (const brand of brands) {
    const bySupplier: Record<string, Record<string, string>> = {};
    for (const suggestion of brand.suggestions ?? []) {
      if (
        suggestion.mappingStatus !== "MATCHED_SUPPLIER" ||
        !suggestion.supplierId
      ) {
        continue;
      }
      const supplierId = suggestion.supplierId;
      bySupplier[supplierId] = {
        ...(bySupplier[supplierId] ?? {}),
        [suggestion.requirementItemId]: suggestion.suggestedRequestQty,
      };
    }
    next[brand.requirementId] = bySupplier;
  }
  return next;
}

export function OsfImportDistributeWizard({
  importId,
  brands,
  confirmedAt,
}: {
  importId: string;
  brands: WizardBrand[];
  confirmedAt: string | null;
}) {
  const [modes, setModes] = useState<Record<string, BrandMode>>(() =>
    Object.fromEntries(
      brands.map((b) => [
        b.requirementId,
        (b.prefillSupplierIds?.length ?? 0) > 0
          ? ("SELECTED" as BrandMode)
          : ("ALL_MATCHING" as BrandMode),
      ]),
    ),
  );
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      brands.map((b) => [
        b.requirementId,
        [...(b.prefillSupplierIds ?? [])],
      ]),
    ),
  );
  /** F1 shared overrides (used when brand has no suggestion-driven recipients). */
  const [qtyOverrides, setQtyOverrides] = useState<
    Record<string, Record<string, string>>
  >(() => Object.fromEntries(brands.map((b) => [b.requirementId, {}])));
  /** F2C per-supplier item quantities. */
  const [supplierItemQty, setSupplierItemQty] = useState<SupplierItemQty>(() =>
    buildInitialSupplierItemQty(brands),
  );
  const [ignoredSuppliers, setIgnoredSuppliers] = useState<
    Record<string, string[]>
  >(() => Object.fromEntries(brands.map((b) => [b.requirementId, [] as string[]])));
  const [acknowledgeOverQty, setAcknowledgeOverQty] = useState(false);
  const [responseDeadline, setResponseDeadline] = useState("");
  const [retryFailedOnly, setRetryFailedOnly] = useState(false);

  const [state, formAction, pending] = useActionState(
    distributeOsfImportAction,
    undefined as DistributeActionResult | undefined,
  );

  const hasFailedLedger = brands.some((b) => b.ledgerStatus === "FAILED");

  const overQty = useMemo(() => {
    for (const brand of brands) {
      const useSuggestions = (brand.suggestions?.length ?? 0) > 0;
      if (useSuggestions) {
        const sums = new Map<string, number>();
        const ignored = new Set(ignoredSuppliers[brand.requirementId] ?? []);
        const mode = modes[brand.requirementId] ?? "SELECTED";
        const selectedIds = new Set(selected[brand.requirementId] ?? []);
        for (const supplier of brand.suppliers) {
          if (supplier.status !== "ACTIVE" || supplier.alreadyRequested) continue;
          if (ignored.has(supplier.id)) continue;
          if (mode === "SELECTED" && !selectedIds.has(supplier.id)) continue;
          const qtys = supplierItemQty[brand.requirementId]?.[supplier.id] ?? {};
          for (const item of brand.items) {
            const raw = qtys[item.id]?.trim();
            if (!raw) continue;
            const n = Number(raw);
            if (!Number.isFinite(n) || n <= 0) continue;
            if (n > Number(item.quantityPlanned)) return true;
            sums.set(item.id, (sums.get(item.id) ?? 0) + n);
          }
        }
        for (const item of brand.items) {
          if ((sums.get(item.id) ?? 0) > Number(item.quantityPlanned)) {
            return true;
          }
        }
      } else {
        const overrides = qtyOverrides[brand.requirementId] ?? {};
        for (const item of brand.items) {
          const raw = overrides[item.id];
          if (!raw?.trim()) continue;
          const n = Number(raw);
          if (Number.isFinite(n) && n > Number(item.quantityPlanned)) {
            return true;
          }
        }
      }
    }
    return false;
  }, [brands, qtyOverrides, supplierItemQty, ignoredSuppliers, modes, selected]);

  function toggleSupplier(requirementId: string, supplierId: string) {
    setSelected((prev) => {
      const cur = new Set(prev[requirementId] ?? []);
      if (cur.has(supplierId)) cur.delete(supplierId);
      else cur.add(supplierId);
      return { ...prev, [requirementId]: [...cur] };
    });
  }

  function toggleIgnoreSupplier(requirementId: string, supplierId: string) {
    setIgnoredSuppliers((prev) => {
      const cur = new Set(prev[requirementId] ?? []);
      if (cur.has(supplierId)) cur.delete(supplierId);
      else cur.add(supplierId);
      return { ...prev, [requirementId]: [...cur] };
    });
  }

  const payloadBrands = brands
    .filter((b) => {
      if (retryFailedOnly) {
        return b.ledgerStatus === "FAILED" || b.ledgerStatus == null;
      }
      return (
        b.ledgerStatus !== "SUCCEEDED" &&
        b.ledgerStatus !== "SKIPPED_ALREADY_REQUESTED"
      );
    })
    .map((b) => {
      const useSuggestions = (b.suggestions?.length ?? 0) > 0;
      if (useSuggestions) {
        const ignored = new Set(ignoredSuppliers[b.requirementId] ?? []);
        const mode = modes[b.requirementId] ?? "SELECTED";
        const selectedIds = new Set(selected[b.requirementId] ?? []);
        const supplierRecipients = b.suppliers
          .filter((s) => s.status === "ACTIVE" && !s.alreadyRequested)
          .filter((s) => !ignored.has(s.id))
          .filter((s) => mode !== "SELECTED" || selectedIds.has(s.id))
          .map((s) => {
            const qtys = supplierItemQty[b.requirementId]?.[s.id] ?? {};
            const items = b.items
              .map((item) => {
                const raw = qtys[item.id]?.trim();
                if (!raw) return null;
                const n = Number(raw);
                if (!Number.isFinite(n) || n <= 0) return null;
                return {
                  requirementItemId: item.id,
                  quantityRequested: n,
                };
              })
              .filter((row): row is NonNullable<typeof row> => row != null);
            return { supplierId: s.id, items };
          })
          .filter((r) => r.items.length > 0);

        return {
          requirementId: b.requirementId,
          mode: modes[b.requirementId] ?? "SELECTED",
          supplierIds:
            modes[b.requirementId] === "SELECTED"
              ? (selected[b.requirementId] ?? [])
              : [],
          supplierRecipients,
        };
      }

      const overrides = Object.entries(qtyOverrides[b.requirementId] ?? {})
        .filter(([, v]) => v.trim().length > 0)
        .map(([requirementItemId, quantityRequested]) => ({
          requirementItemId,
          quantityRequested: Number(quantityRequested),
        }));
      return {
        requirementId: b.requirementId,
        mode: modes[b.requirementId] ?? "ALL_MATCHING",
        supplierIds:
          modes[b.requirementId] === "SELECTED"
            ? (selected[b.requirementId] ?? [])
            : [],
        quantityOverrides: overrides.length ? overrides : undefined,
      };
    });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        if (payloadBrands.length === 0) {
          e.preventDefault();
          return;
        }
        const lines = [
          "Send availability requests for this import?",
          "",
          `Brands to send: ${payloadBrands.length}`,
          responseDeadline
            ? `Response deadline: ${responseDeadline}`
            : "Response deadline: none",
          "",
          "No purchase orders will be created.",
          "Succeeded brands will not be resent.",
          "Suggestions are request quantities only — not supplier availability.",
        ];
        if (!window.confirm(lines.join("\n"))) {
          e.preventDefault();
          return;
        }
        const keyInput = e.currentTarget.elements.namedItem("idempotencyKey");
        if (keyInput instanceof HTMLInputElement) {
          keyInput.value = crypto.randomUUID();
        }
        const brandsInput = e.currentTarget.elements.namedItem("brandsJson");
        if (brandsInput instanceof HTMLInputElement) {
          brandsInput.value = JSON.stringify(payloadBrands);
        }
      }}
    >
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="idempotencyKey" value="" />
      <input type="hidden" name="brandsJson" value="" />
      <input
        type="hidden"
        name="acknowledgeOverQty"
        value={acknowledgeOverQty ? "true" : "false"}
      />
      <input
        type="hidden"
        name="retryFailedOnly"
        value={retryFailedOnly ? "true" : "false"}
      />

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Distribution settings</h2>
        <p className="text-sm text-muted-foreground">
          Confirmed import
          {confirmedAt
            ? ` · ${new Date(confirmedAt).toLocaleString()}`
            : ""}
          . Sends supplier availability requests only — no purchase orders.
        </p>
        <label className="flex max-w-md flex-col gap-1 text-sm">
          <span className="font-medium">Response deadline (optional)</span>
          <input
            type="datetime-local"
            name="responseDeadline"
            value={responseDeadline}
            onChange={(e) => setResponseDeadline(e.target.value)}
            className="min-h-11 rounded-md border border-input bg-background px-3"
          />
        </label>
        {hasFailedLedger ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={retryFailedOnly}
              onChange={(e) => setRetryFailedOnly(e.target.checked)}
            />
            Retry failed brands only (skip already succeeded)
          </label>
        ) : null}
        {overQty ? (
          <label className="flex min-h-11 items-start gap-2 text-sm text-amber-400">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledgeOverQty}
              onChange={(e) => setAcknowledgeOverQty(e.target.checked)}
              required
            />
            <span>
              One or more requested quantities (or supplier totals for an item)
              exceed planned requirement. Acknowledge to continue. Original
              requirement quantities are not changed.
            </span>
          </label>
        ) : null}
      </section>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state?.ok && state.brands ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          role="status"
        >
          <h2 className="text-lg font-medium">Results</h2>
          {state.replay ? (
            <p className="text-sm text-muted-foreground">
              Idempotent replay — no additional requests were created.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2 text-sm">
            {state.brands.map((row) => (
              <li
                key={row.requirementId}
                className={cn("flex flex-col gap-0.5", outcomeTone(row.status))}
              >
                <span className="font-medium">
                  {row.brandName}: {outcomeLabel(row.status)}
                </span>
                {row.status === "SUCCEEDED" ? (
                  <span className="text-muted-foreground">
                    {row.requestIds.length} request
                    {row.requestIds.length === 1 ? "" : "s"} created
                  </span>
                ) : null}
                {row.status === "SKIPPED_ALREADY_REQUESTED" ? (
                  <span className="text-muted-foreground">
                    Not counted as a successful send
                  </span>
                ) : null}
                {row.error ? (
                  <span className="text-destructive">{row.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-6">
        {brands.map((brand) => {
          const eligible = brand.suppliers.filter(
            (s) => s.status === "ACTIVE" && !s.alreadyRequested,
          );
          const mode = modes[brand.requirementId] ?? "ALL_MATCHING";
          const terminal =
            brand.ledgerStatus === "SUCCEEDED" ||
            brand.ledgerStatus === "SKIPPED_ALREADY_REQUESTED";
          const skippedFromRetry =
            retryFailedOnly && brand.ledgerStatus !== "FAILED";
          const useSuggestions = (brand.suggestions?.length ?? 0) > 0;
          const ignored = new Set(ignoredSuppliers[brand.requirementId] ?? []);

          return (
            <section
              key={brand.requirementId}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-medium">{brand.brandName}</h3>
                  {brand.title ? (
                    <p className="text-sm text-muted-foreground">{brand.title}</p>
                  ) : null}
                  {useSuggestions ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Cosmo suggestions prefilled for matched suppliers. Accept,
                      modify, or ignore per supplier/item. Ignored lines never
                      fall back to planned qty.
                    </p>
                  ) : null}
                </div>
                {brand.ledgerStatus ? (
                  <span
                    className={cn(
                      "text-sm font-medium",
                      outcomeTone(
                        brand.ledgerStatus === "SUCCEEDED"
                          ? "ALREADY_SUCCEEDED"
                          : brand.ledgerStatus,
                      ),
                    )}
                  >
                    {outcomeLabel(
                      brand.ledgerStatus === "SUCCEEDED"
                        ? "ALREADY_SUCCEEDED"
                        : brand.ledgerStatus,
                    )}
                  </span>
                ) : null}
              </div>
              {brand.lastError && brand.ledgerStatus === "FAILED" ? (
                <p className="text-sm text-destructive" role="status">
                  {brand.lastError}
                </p>
              ) : null}

              {!useSuggestions ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-3 py-3 font-medium">SKU</th>
                        <th className="px-3 py-3 font-medium">Description</th>
                        <th className="px-3 py-3 font-medium">Planned</th>
                        <th className="px-3 py-3 font-medium">Request qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brand.items.map((item) => (
                        <tr key={item.id} className="border-b last:border-0">
                          <td className="px-3 py-3 tabular-nums">
                            {item.product.sku ?? "—"}
                          </td>
                          <td className="px-3 py-3">{item.product.name}</td>
                          <td className="px-3 py-3 tabular-nums">
                            {item.quantityPlanned}
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min="0.0001"
                              step="any"
                              disabled={terminal || skippedFromRetry || pending}
                              placeholder={item.quantityPlanned}
                              value={
                                qtyOverrides[brand.requirementId]?.[item.id] ??
                                ""
                              }
                              onChange={(e) =>
                                setQtyOverrides((prev) => ({
                                  ...prev,
                                  [brand.requirementId]: {
                                    ...(prev[brand.requirementId] ?? {}),
                                    [item.id]: e.target.value,
                                  },
                                }))
                              }
                              className="min-h-11 w-28 rounded-md border border-input bg-background px-2"
                              aria-label={`Request quantity for ${item.product.sku ?? item.product.name}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {!terminal && !skippedFromRetry ? (
                <>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">Recipients</legend>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={mode === "ALL_MATCHING"}
                        onChange={() =>
                          setModes((prev) => ({
                            ...prev,
                            [brand.requirementId]: "ALL_MATCHING",
                          }))
                        }
                      />
                      All matching suppliers ({eligible.length} eligible)
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={mode === "SELECTED"}
                        onChange={() =>
                          setModes((prev) => ({
                            ...prev,
                            [brand.requirementId]: "SELECTED",
                          }))
                        }
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
                          {useSuggestions ? (
                            <th className="px-3 py-3 font-medium">Ignore</th>
                          ) : null}
                          <th className="px-3 py-3 font-medium">Supplier</th>
                          <th className="px-3 py-3 font-medium">Cosmo / match</th>
                          <th className="px-3 py-3 font-medium">Status</th>
                          {useSuggestions
                            ? brand.items.map((item) => (
                                <th
                                  key={item.id}
                                  className="px-3 py-3 font-medium"
                                >
                                  {item.product.sku ?? item.product.name}
                                  <span className="block text-xs font-normal text-muted-foreground">
                                    plan {item.quantityPlanned}
                                  </span>
                                </th>
                              ))
                            : null}
                        </tr>
                      </thead>
                      <tbody>
                        {brand.suppliers.map((supplier) => {
                          const disabled =
                            supplier.status !== "ACTIVE" ||
                            supplier.alreadyRequested;
                          const supplierSuggestions = (
                            brand.suggestions ?? []
                          ).filter((s) => s.supplierId === supplier.id);
                          const unresolvedHints = (brand.suggestions ?? []).filter(
                            (s) =>
                              s.mappingStatus === "UNRESOLVED_SUPPLIER" &&
                              !s.supplierId,
                          );
                          return (
                            <tr
                              key={supplier.id}
                              className={cn(
                                "border-b last:border-0",
                                ignored.has(supplier.id)
                                  ? "opacity-60"
                                  : undefined,
                              )}
                            >
                              {mode === "SELECTED" ? (
                                <td className="px-3 py-3">
                                  <input
                                    type="checkbox"
                                    className="size-4"
                                    disabled={disabled || pending}
                                    checked={(
                                      selected[brand.requirementId] ?? []
                                    ).includes(supplier.id)}
                                    onChange={() =>
                                      toggleSupplier(
                                        brand.requirementId,
                                        supplier.id,
                                      )
                                    }
                                  />
                                </td>
                              ) : null}
                              {useSuggestions ? (
                                <td className="px-3 py-3">
                                  <input
                                    type="checkbox"
                                    className="size-4"
                                    disabled={disabled || pending}
                                    checked={ignored.has(supplier.id)}
                                    onChange={() =>
                                      toggleIgnoreSupplier(
                                        brand.requirementId,
                                        supplier.id,
                                      )
                                    }
                                    aria-label={`Ignore ${supplier.name}`}
                                  />
                                </td>
                              ) : null}
                              <td className="px-3 py-3 font-medium">
                                {supplier.name}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground">
                                {supplierSuggestions[0] ? (
                                  <span>
                                    {supplierSuggestions[0].cosmoSupplierName}
                                    {supplierSuggestions[0].cosmoSupplierCode
                                      ? ` (${supplierSuggestions[0].cosmoSupplierCode})`
                                      : ""}
                                    <span className="block text-xs">
                                      {supplierSuggestions[0].mappingStatus.replaceAll(
                                        "_",
                                        " ",
                                      )}
                                    </span>
                                  </span>
                                ) : (
                                  <span>
                                    {supplier.supportsAllBrands
                                      ? "All brands"
                                      : "Brand match"}
                                    {unresolvedHints.length > 0 &&
                                    supplier === brand.suppliers[0] ? (
                                      <span className="block text-xs text-amber-400">
                                        Unresolved Cosmo suggestions exist —
                                        map in Import Review
                                      </span>
                                    ) : null}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {supplier.alreadyRequested
                                  ? `Active request (${supplier.existingStatus})`
                                  : supplier.status}
                              </td>
                              {useSuggestions
                                ? brand.items.map((item) => {
                                    const sug = supplierSuggestions.find(
                                      (s) => s.requirementItemId === item.id,
                                    );
                                    return (
                                      <td key={item.id} className="px-3 py-3">
                                        <input
                                          type="number"
                                          min="0"
                                          step="any"
                                          disabled={
                                            terminal ||
                                            skippedFromRetry ||
                                            pending ||
                                            disabled ||
                                            ignored.has(supplier.id)
                                          }
                                          placeholder={
                                            sug?.suggestedRequestQty ?? "ignore"
                                          }
                                          value={
                                            supplierItemQty[
                                              brand.requirementId
                                            ]?.[supplier.id]?.[item.id] ?? ""
                                          }
                                          onChange={(e) =>
                                            setSupplierItemQty((prev) => ({
                                              ...prev,
                                              [brand.requirementId]: {
                                                ...(prev[brand.requirementId] ??
                                                  {}),
                                                [supplier.id]: {
                                                  ...(prev[
                                                    brand.requirementId
                                                  ]?.[supplier.id] ?? {}),
                                                  [item.id]: e.target.value,
                                                },
                                              },
                                            }))
                                          }
                                          className="min-h-11 w-24 rounded-md border border-input bg-background px-2"
                                          aria-label={`Qty for ${supplier.name} / ${item.product.sku ?? item.product.name}`}
                                        />
                                        {sug?.overLineQty ? (
                                          <span className="mt-1 block text-xs text-amber-400">
                                            Over-line
                                          </span>
                                        ) : null}
                                      </td>
                                    );
                                  })
                                : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {useSuggestions ? (
                    <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">
                        Unmapped Cosmo suggestions
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {(brand.suggestions ?? [])
                          .filter((s) => s.mappingStatus !== "MATCHED_SUPPLIER")
                          .map((s) => (
                            <li key={s.suggestionId}>
                              {s.cosmoSupplierName} ({s.cosmoSupplierId}) ·{" "}
                              {s.mappingStatus.replaceAll("_", " ")} · qty{" "}
                              {s.suggestedRequestQty} · {s.lineKey}
                            </li>
                          ))}
                        {(brand.suggestions ?? []).every(
                          (s) => s.mappingStatus === "MATCHED_SUPPLIER",
                        ) ? (
                          <li>None</li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-4 backdrop-blur">
        <button
          type="submit"
          disabled={
            pending ||
            payloadBrands.length === 0 ||
            (overQty && !acknowledgeOverQty)
          }
          aria-busy={pending}
          className={cn(
            buttonVariants({ className: "min-h-11 w-full sm:w-fit" }),
          )}
        >
          {pending ? "Sending…" : "Send Availability Requests"}
        </button>
        {payloadBrands.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No brands left to send. Use a separate workflow for additional
            requests after skip/success.
          </p>
        ) : null}
      </div>
    </form>
  );
}
