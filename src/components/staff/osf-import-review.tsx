"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ActionResult } from "@/app/staff/osf-imports/actions";
import {
  confirmImportAction,
  createBrandAndResolveAction,
  excludeLineAction,
  includeZeroQtyLineAction,
  linkProductAction,
  mapUnresolvedCosmoSupplierAction,
  resolveBrandAction,
  restoreLineAction,
  updateLineQtyAction,
} from "@/app/staff/osf-imports/actions";
import { OsfImportStatusBadge } from "@/components/staff/osf-import-status-badge";
import { OsfUnresolvedCosmoMapping } from "@/components/staff/osf-unresolved-cosmo-mapping";
import { buttonVariants } from "@/components/ui/button";
import type { OsfImportReviewModel } from "@/lib/osf-imports/queries";
import { coverageLabel, isBelowCoverage, parseCoverageThreshold, stockCoverage } from "@/lib/osf-imports/stock-coverage";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };
type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  brandId: string;
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";

function SaveState({
  pending,
  result,
}: {
  pending: boolean;
  result: ActionResult | undefined;
}) {
  if (pending) {
    return (
      <span role="status" className="text-sm text-muted-foreground">
        Saving…
      </span>
    );
  }
  if (result?.ok) {
    return (
      <span role="status" className="text-sm text-success">
        Saved
      </span>
    );
  }
  if (result && !result.ok) {
    return (
      <span role="alert" className="text-sm text-destructive">
        {result.error}
      </span>
    );
  }
  return null;
}

function matchesQuery(
  query: string,
  parts: Array<string | null | undefined>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return parts.some((p) => (p ?? "").toLowerCase().includes(q));
}

export function OsfImportReview({
  model,
  brands,
  products,
}: {
  model: OsfImportReviewModel;
  brands: BrandOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<ActionResult | undefined>();
  const [coverageInput, setCoverageInput] = useState("");
  const [appliedCoverage, setAppliedCoverage] = useState("");
  const [coverageError, setCoverageError] = useState(false);
  const [showUnknownCoverage, setShowUnknownCoverage] = useState(false);

  const matchingBrands = useMemo(() => {
    return model.brands
      .map((group) => {
        const lines = group.lines.filter((line) => {
          if (issuesOnly) {
            const issue =
              line.mappingStatus === "UNKNOWN_SKU" ||
              line.mappingStatus === "AMBIGUOUS_SKU" ||
              line.mappingStatus === "UNKNOWN_BRAND" ||
              line.mappingStatus === "REJECTED_ZERO_QTY" ||
              line.mappingStatus === "REJECTED_INVALID_QTY" ||
              line.mappingStatus === "EXCLUDED";
            if (!issue) return false;
          }
          return matchesQuery(query, [
            line.sku,
            line.descriptionSnapshot,
            line.brandNameSnapshot,
            line.productName,
            line.cosmoVendorId,
            line.erp1Priority,
            line.erp2Priority,
          ]);
        });
        return { ...group, lines };
      })
      .filter((g) => g.lines.length > 0);
  }, [model.brands, query, issuesOnly]);

  const coverageById = useMemo(() => new Map(model.brands.flatMap((group) =>
    group.lines.map((line) => [line.id, stockCoverage(line.totalStock, line.totalRop)] as const),
  )), [model.brands]);
  const threshold = useMemo(() => parseCoverageThreshold(appliedCoverage), [appliedCoverage]);
  const unknownCoverageCount = matchingBrands.reduce((count, group) =>
    count + group.lines.filter((line) => coverageById.get(line.id)?.kind !== "known").length, 0);
  const filteredBrands = useMemo(() => {
    if (!threshold) return matchingBrands;
    return matchingBrands.map((group) => ({
      ...group,
      lines: group.lines.filter((line) => {
        const coverage = coverageById.get(line.id)!;
        return showUnknownCoverage ? coverage.kind !== "known" : isBelowCoverage(coverage, threshold);
      }),
    })).filter((group) => group.lines.length > 0);
  }, [matchingBrands, threshold, coverageById, showUnknownCoverage]);

  function clearCoverage() {
    setCoverageInput("");
    setAppliedCoverage("");
    setCoverageError(false);
    setShowUnknownCoverage(false);
  }

  const hiddenCount =
    model.summary.lineCount -
    filteredBrands.reduce((n, g) => n + g.lines.length, 0);

  function runAction(
    action: (
      prev: ActionResult | undefined,
      formData: FormData,
    ) => Promise<ActionResult>,
    formData: FormData,
  ) {
    startTransition(async () => {
      const result = await action(undefined, formData);
      setFlash(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Status" value={model.status.replaceAll("_", " ")} />
        <SummaryStat label="Brands" value={String(model.summary.brandCount)} />
        <SummaryStat label="Lines" value={String(model.summary.lineCount)} />
        <SummaryStat
          label="Proposed qty"
          value={String(model.summary.totalQuantityProposed)}
        />
        <SummaryStat
          label="Matched"
          value={String(model.summary.matchedCount)}
        />
        <SummaryStat
          label="Unresolved"
          value={String(model.summary.unresolvedCount)}
        />
        <SummaryStat
          label="Excluded / rejected"
          value={String(
            model.summary.excludedCount + model.summary.rejectedCount,
          )}
        />
        <SummaryStat
          label="Planned qty"
          value={String(model.summary.totalQuantityPlanned)}
        />
      </section>

      {model.summary.suggestions.total > 0 ? (
        <section
          className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Cosmo request suggestion summary"
        >
          <SummaryStat
            label="Suggestions"
            value={String(model.summary.suggestions.total)}
          />
          <SummaryStat
            label="Suggestion matched"
            value={String(model.summary.suggestions.matched)}
          />
          <SummaryStat
            label="Suggestion unresolved"
            value={String(model.summary.suggestions.unresolved)}
          />
          <SummaryStat
            label="Suggestion ineligible"
            value={String(model.summary.suggestions.ineligible)}
          />
          <SummaryStat
            label="Suggestion non-actionable"
            value={String(model.summary.suggestions.nonActionable)}
          />
          <SummaryStat
            label="Over-line warnings"
            value={String(model.summary.suggestions.overLineWarnings)}
          />
        </section>
      ) : null}

      <OsfUnresolvedCosmoMapping
        importId={model.importId}
        unresolved={model.unresolvedCosmoSuppliers}
        mappableSuppliers={model.mappableSuppliers}
        canMap={model.canMapCosmoSuppliers}
        action={mapUnresolvedCosmoSupplierAction}
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
            <span className="text-sm font-medium">Search</span>
            <input
              className={fieldClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SKU, product, brand…"
              aria-label="Search import lines"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={issuesOnly}
              onChange={(e) => setIssuesOnly(e.target.checked)}
            />
            Issues only
          </label>
          {(query || issuesOnly || appliedCoverage) && (
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}
              onClick={() => {
                setQuery("");
                setIssuesOnly(false);
                clearCoverage();
              }}
            >
              Reset filters
            </button>
          )}
        </div>
        <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={(event) => {
          event.preventDefault();
          const valid = parseCoverageThreshold(coverageInput);
          setCoverageError(!valid);
          if (valid) {
            setAppliedCoverage(coverageInput.trim());
            setShowUnknownCoverage(false);
          }
        }}>
          <label className="grid min-w-0 flex-1 basis-52 gap-1.5 text-sm font-medium">
            Stock Coverage %
            <input
              className={fieldClass}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              placeholder="e.g. 27.5"
              value={coverageInput}
              onChange={(event) => setCoverageInput(event.target.value)}
              aria-invalid={coverageError}
              aria-describedby={coverageError ? "stock-coverage-error" : undefined}
            />
          </label>
          <button type="submit" className={cn(buttonVariants({ className: "min-h-11" }))}>Apply filter</button>
          <button type="button" onClick={clearCoverage}
            className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}>Clear filter</button>
        </form>
        {coverageError && <p id="stock-coverage-error" className="text-sm text-destructive" role="alert">
          Enter a percentage from 0 to 100 with up to 12 decimal places.
        </p>}
        {threshold && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm" role="status">
              {showUnknownCoverage ? "Showing unknown or N/A coverage." : `Showing coverage below ${appliedCoverage}%.`}
            </p>
            <button type="button" className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}
              onClick={() => setShowUnknownCoverage((current) => !current)}>
              {showUnknownCoverage ? "Show matching coverage" : `Show unknown or N/A (${unknownCoverageCount})`}
            </button>
          </div>
        )}
        {model.stockAsOfDate && <p className="text-sm text-muted-foreground">Stock snapshot: {model.stockAsOfDate}</p>}
        {filteredBrands.length === 0 && <p className="text-sm text-muted-foreground">No import lines match these filters.</p>}
        {hiddenCount > 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Showing a filtered subset ({hiddenCount} line
            {hiddenCount === 1 ? "" : "s"} hidden). Reset filters to see the
            complete import.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Showing all {model.summary.lineCount} imported lines. Brand groups
            stay expanded.
          </p>
        )}
        <SaveState pending={pending} result={flash} />
      </section>

      <div className="flex min-w-0 flex-col gap-6 overflow-x-hidden">
        {filteredBrands.map((group) => {
          const unknownBrandLines = group.lines.filter(
            (l) => l.mappingStatus === "UNKNOWN_BRAND",
          );
          const brandAnchor = unknownBrandLines[0] ?? group.lines[0];
          const affectedPreview = unknownBrandLines
            .map((l) => `${l.sku} — ${l.descriptionSnapshot}`)
            .join("\n");

          return (
            <section
              key={group.brandKey}
              className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/60 p-4"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 className="break-words text-xl font-semibold tracking-tight">
                    {group.brandName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Cosmo vendor: {group.cosmoVendorId ?? "—"}
                    {group.requirementId
                      ? ` · Draft requirement linked`
                      : " · No draft requirement yet"}
                    {group.issueCount > 0
                      ? ` · ${group.issueCount} issue${group.issueCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <OsfImportStatusBadge
                  status={
                    group.brandMapping === "UNKNOWN"
                      ? "UNKNOWN_BRAND"
                      : "MATCHED_SKU"
                  }
                />
              </header>

              {model.editable &&
              model.canManageRequirements &&
              unknownBrandLines.length > 0 &&
              brandAnchor ? (
                <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">
                      Review before resolving brand
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Applying a brand updates every UNKNOWN_BRAND line in this
                      Cosmo vendor group, then rematches SKUs.
                    </p>
                    <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-sm">
                      {unknownBrandLines.map((l) => (
                        <li key={l.id} className="break-words">
                          <span className="font-medium">{l.sku}</span>
                          {" — "}
                          {l.descriptionSnapshot}
                          {" · qty "}
                          {l.quantityPlanned}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <form
                      className="flex min-w-0 flex-col gap-2"
                      action={(fd) => runAction(resolveBrandAction, fd)}
                      onSubmit={(e) => {
                        if (
                          !window.confirm(
                            `Apply brand to ${unknownBrandLines.length} line(s)?\n\n${affectedPreview}`,
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="importId" value={model.importId} />
                      <input type="hidden" name="lineId" value={brandAnchor.id} />
                      <input
                        type="hidden"
                        name="lineVersion"
                        value={brandAnchor.version}
                      />
                      <input
                        type="hidden"
                        name="importVersion"
                        value={model.version}
                      />
                      <input type="hidden" name="applyToBrandGroup" value="true" />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium">
                          Link existing brand
                        </span>
                        <select
                          className={fieldClass}
                          name="brandId"
                          required
                          disabled={pending}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Select brand…
                          </option>
                          {brands.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={pending}
                        className={cn(
                          buttonVariants({
                            variant: "outline",
                            className: "min-h-11 w-full",
                          }),
                        )}
                      >
                        Apply brand to {unknownBrandLines.length} line
                        {unknownBrandLines.length === 1 ? "" : "s"}
                      </button>
                    </form>

                    {model.canManageBrands ? (
                      <form
                        className="flex min-w-0 flex-col gap-2"
                        action={(fd) =>
                          runAction(createBrandAndResolveAction, fd)
                        }
                        onSubmit={(e) => {
                          if (
                            !window.confirm(
                              `Create brand and rematch ${unknownBrandLines.length} line(s)?\n\n${affectedPreview}`,
                            )
                          ) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <input
                          type="hidden"
                          name="importId"
                          value={model.importId}
                        />
                        <input
                          type="hidden"
                          name="lineId"
                          value={brandAnchor.id}
                        />
                        <input
                          type="hidden"
                          name="lineVersion"
                          value={brandAnchor.version}
                        />
                        <input
                          type="hidden"
                          name="importVersion"
                          value={model.version}
                        />
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium">
                            Create brand (MANAGE_BRANDS)
                          </span>
                          <input
                            className={fieldClass}
                            name="name"
                            defaultValue={group.brandName}
                            required
                            disabled={pending}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={pending}
                          className={cn(
                            buttonVariants({
                              variant: "outline",
                              className: "min-h-11 w-full",
                            }),
                          )}
                        >
                          Create brand & rematch
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex min-w-0 flex-col gap-3">
                {group.lines.map((line) => {
                  const brandProducts = products.filter(
                    (p) => p.brandId === (line.brandId ?? ""),
                  );
                  return (
                    <article
                      key={line.id}
                      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background/80 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-medium">
                            {line.productName ?? line.descriptionSnapshot}
                          </p>
                          <p className="break-words text-sm text-muted-foreground">
                            SKU {line.sku}
                            {line.erp1Priority
                              ? ` · ERP1 ${line.erp1Priority}`
                              : ""}
                            {line.erp2Priority
                              ? ` · ERP2 ${line.erp2Priority}`
                              : ""}
                          </p>
                          <p className="break-words text-sm text-muted-foreground">
                            Stock {line.totalStock ?? "Unknown"} · ROP {line.totalRop ?? "Unknown"} · Coverage {coverageLabel(coverageById.get(line.id)!)}
                          </p>
                          {line.productId && (
                            <Link className="inline-flex min-h-11 items-center text-sm underline"
                              href={`/staff/osf-imports/${encodeURIComponent(model.importId)}/purchase-history/${encodeURIComponent(line.id)}`}>
                              Purchase history
                            </Link>
                          )}
                          <p className="text-sm text-muted-foreground">
                            Proposed {line.quantityProposed}
                            {line.resolutionNote
                              ? ` · ${line.resolutionNote}`
                              : ""}
                          </p>
                        </div>
                        <OsfImportStatusBadge status={line.mappingStatus} />
                      </div>

                      {model.editable && model.canManageRequirements ? (
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                          {line.mappingStatus === "REJECTED_ZERO_QTY" ? (
                            <form
                              className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2 sm:col-span-2"
                              action={(fd) =>
                                runAction(includeZeroQtyLineAction, fd)
                              }
                              onSubmit={(e) => {
                                if (
                                  !window.confirm(
                                    "Include this zero-quantity Cosmo line with a new planned quantity? Proposed qty stays unchanged.",
                                  )
                                ) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <p className="text-xs text-muted-foreground">
                                Zero Cosmo qty — not orderable until you
                                explicitly include it. Proposed{" "}
                                {line.quantityProposed} stays immutable.
                              </p>
                              <input
                                type="hidden"
                                name="importId"
                                value={model.importId}
                              />
                              <input
                                type="hidden"
                                name="lineId"
                                value={line.id}
                              />
                              <input
                                type="hidden"
                                name="lineVersion"
                                value={line.version}
                              />
                              <input
                                type="hidden"
                                name="importVersion"
                                value={model.version}
                              />
                              <label className="flex min-w-0 flex-col gap-1">
                                <span className="text-xs font-medium">
                                  Include with planned qty
                                </span>
                                <input
                                  className={fieldClass}
                                  name="quantityPlanned"
                                  type="number"
                                  min={0.0001}
                                  step="any"
                                  required
                                  disabled={pending}
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={pending}
                                className={cn(
                                  buttonVariants({
                                    className: "min-h-11 w-full sm:w-auto",
                                  }),
                                )}
                              >
                                Include line
                              </button>
                            </form>
                          ) : null}

                          {line.editableQty ? (
                            <form
                              className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                              action={(fd) =>
                                runAction(updateLineQtyAction, fd)
                              }
                            >
                              <input
                                type="hidden"
                                name="importId"
                                value={model.importId}
                              />
                              <input
                                type="hidden"
                                name="lineId"
                                value={line.id}
                              />
                              <input
                                type="hidden"
                                name="lineVersion"
                                value={line.version}
                              />
                              <input
                                type="hidden"
                                name="importVersion"
                                value={model.version}
                              />
                              <label className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-xs font-medium">
                                  Planned qty
                                </span>
                                <input
                                  className={fieldClass}
                                  name="quantityPlanned"
                                  type="number"
                                  min={0.0001}
                                  step="any"
                                  defaultValue={line.quantityPlanned}
                                  required
                                  disabled={pending}
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={pending}
                                aria-busy={pending}
                                className={cn(
                                  buttonVariants({
                                    className: "min-h-11 w-full sm:w-auto",
                                  }),
                                )}
                              >
                                Save qty
                              </button>
                            </form>
                          ) : null}

                          {line.brandId &&
                          (line.mappingStatus === "UNKNOWN_SKU" ||
                            line.mappingStatus === "AMBIGUOUS_SKU" ||
                            line.mappingStatus === "MATCHED_SKU") ? (
                            <form
                              className="flex min-w-0 flex-col gap-2"
                              action={(fd) =>
                                runAction(linkProductAction, fd)
                              }
                            >
                              <input
                                type="hidden"
                                name="importId"
                                value={model.importId}
                              />
                              <input
                                type="hidden"
                                name="lineId"
                                value={line.id}
                              />
                              <input
                                type="hidden"
                                name="lineVersion"
                                value={line.version}
                              />
                              <input
                                type="hidden"
                                name="importVersion"
                                value={model.version}
                              />
                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium">
                                  Link product
                                </span>
                                <select
                                  className={fieldClass}
                                  name="productId"
                                  required
                                  disabled={pending}
                                  defaultValue={line.productId ?? ""}
                                >
                                  <option value="" disabled>
                                    Select product…
                                  </option>
                                  {brandProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                      {p.sku ? ` (${p.sku})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="submit"
                                disabled={
                                  pending || brandProducts.length === 0
                                }
                                className={cn(
                                  buttonVariants({
                                    variant: "outline",
                                    className: "min-h-11 w-full",
                                  }),
                                )}
                              >
                                Link product
                              </button>
                            </form>
                          ) : null}

                          {line.mappingStatus !== "EXCLUDED" ? (
                            <form
                              className="flex min-w-0 flex-col gap-2"
                              action={(fd) =>
                                runAction(excludeLineAction, fd)
                              }
                              onSubmit={(e) => {
                                if (
                                  !window.confirm(
                                    "Exclude this line from confirmation? It stays visible on this page.",
                                  )
                                ) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <input
                                type="hidden"
                                name="importId"
                                value={model.importId}
                              />
                              <input
                                type="hidden"
                                name="lineId"
                                value={line.id}
                              />
                              <input
                                type="hidden"
                                name="lineVersion"
                                value={line.version}
                              />
                              <input
                                type="hidden"
                                name="importVersion"
                                value={model.version}
                              />
                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium">
                                  Exclude reason
                                </span>
                                <input
                                  className={fieldClass}
                                  name="reason"
                                  required
                                  maxLength={500}
                                  disabled={pending}
                                  placeholder="Why exclude this line?"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={pending}
                                className={cn(
                                  buttonVariants({
                                    variant: "outline",
                                    className: "min-h-11 w-full",
                                  }),
                                )}
                              >
                                Exclude line
                              </button>
                            </form>
                          ) : (
                            <form
                              className="flex min-w-0 flex-col gap-2"
                              action={(fd) =>
                                runAction(restoreLineAction, fd)
                              }
                            >
                              <input
                                type="hidden"
                                name="importId"
                                value={model.importId}
                              />
                              <input
                                type="hidden"
                                name="lineId"
                                value={line.id}
                              />
                              <input
                                type="hidden"
                                name="lineVersion"
                                value={line.version}
                              />
                              <input
                                type="hidden"
                                name="importVersion"
                                value={model.version}
                              />
                              <button
                                type="submit"
                                disabled={pending}
                                className={cn(
                                  buttonVariants({
                                    className: "min-h-11 w-full",
                                  }),
                                )}
                              >
                                Restore line
                              </button>
                            </form>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Review completion</h2>
        {model.status === "CONFIRMED" ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-sm text-muted-foreground">
              Import confirmed
              {model.confirmedAt
                ? ` at ${new Date(model.confirmedAt).toLocaleString()}`
                : ""}
              . Review is read-only. Confirmation did not notify suppliers or
              create purchase orders.
            </p>
            <Link
              href={`/staff/osf-imports/${model.importId}/distribute`}
              className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
            >
              Send availability requests
            </Link>
          </div>
        ) : model.confirmReady && model.canConfirmRequirement ? (
          <>
            <p className="text-sm text-muted-foreground">
              Ready to confirm all brand requirements for this import. Suppliers
              will not be notified and no purchase orders will be created.
            </p>
            <form
              action={(fd) => runAction(confirmImportAction, fd)}
              onSubmit={(e) => {
                const brands = model.summary.confirmableRequirementCount;
                const items = model.summary.includedItemCount;
                const qty = model.summary.includedQuantityPlanned;
                const ok = window.confirm(
                  [
                    "Confirm all requirements for this import?",
                    "",
                    `Brand requirements: ${brands}`,
                    `Included items: ${items}`,
                    `Total planned quantity: ${qty}`,
                    "",
                    "Suppliers will NOT be notified.",
                    "No purchase orders will be created.",
                  ].join("\n"),
                );
                if (!ok) {
                  e.preventDefault();
                  return;
                }
                const keyInput = e.currentTarget.elements.namedItem(
                  "idempotencyKey",
                );
                if (keyInput instanceof HTMLInputElement) {
                  keyInput.value = crypto.randomUUID();
                }
              }}
            >
              <input type="hidden" name="importId" value={model.importId} />
              <input
                type="hidden"
                name="importVersion"
                value={model.version}
              />
              <input type="hidden" name="idempotencyKey" value="" />
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
              >
                Confirm all requirements
              </button>
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {model.status === "READY_TO_CONFIRM" && !model.canConfirmRequirement
              ? "You do not have permission to confirm requirements."
              : "Resolve unknown brands/SKUs or exclude lines until the import is ready to confirm."}
          </p>
        )}
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
