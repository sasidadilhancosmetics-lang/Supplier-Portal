"use client";

import { useActionState } from "react";

import {
  createRequirementAction,
  type ActionResult,
} from "@/app/staff/requirements/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NewRequirementForm({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    createRequirementAction,
    undefined as ActionResult | undefined,
  );

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Brand</span>
        <select
          name="brandId"
          required
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          defaultValue=""
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
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Title</span>
        <input
          name="title"
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          name="notes"
          className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
      >
        {pending ? "Creating…" : "Create draft"}
      </button>
    </form>
  );
}
