"use client";

import { useActionState } from "react";

import type { RegisterActionResult } from "@/app/register/supplier/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BrandOption = { id: string; name: string };

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const labelClass = "text-sm font-medium";

export function SupplierRegistrationForm({
  action,
  brands,
  defaultContactEmail,
  defaultContactName,
}: {
  action: (
    prev: RegisterActionResult | undefined,
    formData: FormData,
  ) => Promise<RegisterActionResult>;
  brands: BrandOption[];
  defaultContactEmail?: string | null;
  defaultContactName?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-6">
      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Company name</span>
          <input className={fieldClass} name="name" required autoComplete="organization" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Contact name</span>
          <input
            className={fieldClass}
            name="contactName"
            required
            defaultValue={defaultContactName ?? ""}
            autoComplete="name"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Contact email</span>
          <input
            className={fieldClass}
            name="contactEmail"
            type="email"
            defaultValue={defaultContactEmail ?? ""}
            autoComplete="email"
          />
          <span className="text-xs text-muted-foreground">
            Defaults to your verified Auth0 email if left blank.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Contact phone</span>
          <input className={fieldClass} name="contactPhone" autoComplete="tel" />
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Brands supplied</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="supportsAllBrands"
            value="true"
            className="mt-1 size-4"
          />
          <span>
            All brands
            <span className="mt-0.5 block text-muted-foreground">
              Select this if you can supply every brand in the catalog.
            </span>
          </span>
        </label>

        {brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No brands are listed yet. You can still register and update brands
            later after approval.
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
                    className="size-4"
                  />
                  {brand.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
      >
        {pending ? "Submitting…" : "Submit registration"}
      </button>
    </form>
  );
}
