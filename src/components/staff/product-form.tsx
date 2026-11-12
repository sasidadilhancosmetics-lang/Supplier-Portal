"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/app/staff/products/actions";
import { buttonVariants } from "@/components/ui/button";
import type { ProductPriorityStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProductForm({
  action,
  brands,
  submitLabel,
  productId,
  defaults,
  readOnlyMaster,
}: {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
  brands: BrandOption[];
  submitLabel: string;
  productId?: string;
  defaults?: {
    name?: string;
    brandId?: string;
    sku?: string | null;
    unitOfMeasure?: string | null;
    priorityStatus?: ProductPriorityStatus;
    isActive?: boolean;
  };
  readOnlyMaster?: {
    masterStatus: string;
    erpItemId: string | null;
    cosmoItemId: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-6">
      {productId ? (
        <input type="hidden" name="productId" value={productId} />
      ) : null}

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="rounded-lg border bg-muted px-4 py-3 text-sm">
          Saved.
        </p>
      ) : null}

      {readOnlyMaster ? (
        <div className="rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
          <p>
            Master status:{" "}
            <span className="font-medium">{readOnlyMaster.masterStatus}</span>
          </p>
          <p>
            ERP Item ID:{" "}
            <span className="font-medium">
              {readOnlyMaster.erpItemId ?? "— (provisional)"}
            </span>
          </p>
          <p>
            Cosmo Item ID:{" "}
            <span className="font-medium">
              {readOnlyMaster.cosmoItemId ?? "—"}
            </span>
          </p>
          <p className="mt-2 text-muted-foreground">
            Manual create always produces PROVISIONAL products. ERP identifiers
            are never invented here.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Development products are created as <strong>PROVISIONAL</strong> with
          no ERP Item ID.
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Product name</span>
        <input
          className={fieldClass}
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Brand</span>
        <select
          className={fieldClass}
          name="brandId"
          required
          defaultValue={defaults?.brandId ?? ""}
        >
          <option value="" disabled>
            Select brand
          </option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">SKU / code</span>
          <input
            className={fieldClass}
            name="sku"
            defaultValue={defaults?.sku ?? ""}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Unit of measure</span>
          <input
            className={fieldClass}
            name="unitOfMeasure"
            defaultValue={defaults?.unitOfMeasure ?? ""}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Priority</span>
        <select
          className={fieldClass}
          name="priorityStatus"
          defaultValue={defaults?.priorityStatus ?? "NORMAL"}
        >
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={defaults?.isActive ?? true}
          className="size-4"
        />
        Active
      </label>

      <button
        type="submit"
        disabled={pending || brands.length === 0}
        className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
