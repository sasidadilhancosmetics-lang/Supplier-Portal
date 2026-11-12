import type { Metadata } from "next";
import Link from "next/link";

import { NewRequirementForm } from "@/components/staff/new-requirement-form";
import { buttonVariants } from "@/components/ui/button";
import { listBrandsForRequirements } from "@/lib/brands/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New requirement",
  description: "Create a draft requirement for development testing.",
};

export const instant = false;

export default async function NewRequirementPage() {
  const brands = await listBrandsForRequirements();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            New draft requirement
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Choose a brand, then add products on the next screen.
          </p>
        </div>
        <Link
          href="/staff/requirements"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back
        </Link>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a brand under{" "}
          <Link
            href="/staff/products"
            className="underline underline-offset-4"
          >
            Products
          </Link>{" "}
          before drafting a requirement.
        </p>
      ) : (
        <NewRequirementForm brands={brands} />
      )}
    </div>
  );
}
