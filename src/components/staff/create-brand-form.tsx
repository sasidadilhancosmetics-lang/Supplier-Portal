"use client";

import { useActionState } from "react";

import type { ActionResult } from "@/app/staff/products/actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CreateBrandForm({
  action,
}: {
  action: (
    prev: ActionResult | undefined,
    formData: FormData,
  ) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end"
    >
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium">New brand (development)</span>
        <input
          name="name"
          required
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          placeholder="Brand name"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonVariants({ className: "min-h-11" }))}
      >
        {pending ? "Creating…" : "Create brand"}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="w-full text-sm text-muted-foreground">
          Brand created.
        </p>
      ) : null}
    </form>
  );
}
