"use client";

import { useActionState } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { ActionResult } from "@/app/admin/suppliers/actions";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };

type SupplierFormValues = {
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
  supportsAllBrands: boolean;
  brandIds: string[];
};

type SupplierFormProps = {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
  brands: BrandOption[];
  defaults?: Partial<SupplierFormValues>;
  supplierId?: string;
  submitLabel: string;
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const labelClass = "text-sm font-medium";

export function SupplierForm({
  action,
  brands,
  defaults,
  supplierId,
  submitLabel,
}: SupplierFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      {supplierId ? (
        <input type="hidden" name="supplierId" value={supplierId} />
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
        <p
          role="status"
          className="rounded-lg border bg-muted px-4 py-3 text-sm"
        >
          Saved.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Company name</span>
          <input
            className={fieldClass}
            name="name"
            required
            defaultValue={defaults?.name ?? ""}
            autoComplete="organization"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Contact name</span>
          <input
            className={fieldClass}
            name="contactName"
            defaultValue={defaults?.contactName ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Contact email</span>
          <input
            className={fieldClass}
            name="contactEmail"
            type="email"
            defaultValue={defaults?.contactEmail ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Contact phone</span>
          <input
            className={fieldClass}
            name="contactPhone"
            defaultValue={defaults?.contactPhone ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Address line 1</span>
          <input
            className={fieldClass}
            name="addressLine1"
            defaultValue={defaults?.addressLine1 ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Address line 2</span>
          <input
            className={fieldClass}
            name="addressLine2"
            defaultValue={defaults?.addressLine2 ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>City</span>
          <input
            className={fieldClass}
            name="city"
            defaultValue={defaults?.city ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Region</span>
          <input
            className={fieldClass}
            name="region"
            defaultValue={defaults?.region ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Postal code</span>
          <input
            className={fieldClass}
            name="postalCode"
            defaultValue={defaults?.postalCode ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Country</span>
          <input
            className={fieldClass}
            name="country"
            defaultValue={defaults?.country ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Notes</span>
          <textarea
            className={cn(fieldClass, "min-h-24 py-2")}
            name="notes"
            defaultValue={defaults?.notes ?? ""}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Brands</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="supportsAllBrands"
            value="true"
            defaultChecked={defaults?.supportsAllBrands ?? false}
            className="mt-1 size-4"
          />
          <span>
            Supports all brands
            <span className="mt-0.5 block text-muted-foreground">
              Matches every brand for request distribution. Specific brands may
              still be listed below.
            </span>
          </span>
        </label>

        {brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No brands exist for this company yet. You can still save the
            supplier and assign brands later.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {brands.map((brand) => (
              <li key={brand.id}>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
                  <input
                    type="checkbox"
                    name="brandIds"
                    value={brand.id}
                    defaultChecked={defaults?.brandIds?.includes(brand.id)}
                    className="size-4"
                  />
                  {brand.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
