import type { Metadata } from "next";
import Link from "next/link";

import {
  createBrandAction,
  createProductAction,
} from "@/app/staff/products/actions";
import { CreateBrandForm } from "@/components/staff/create-brand-form";
import { ProductForm } from "@/components/staff/product-form";
import { buttonVariants } from "@/components/ui/button";
import { listBrandsForCompany } from "@/lib/brands/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New product",
  description: "Create a provisional development product.",
};

export const instant = false;

export default async function NewProductPage() {
  const brands = await listBrandsForCompany();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            New provisional product
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Development-only create. Does not create ERP masters or invent ERP
            Item IDs.
          </p>
        </div>
        <Link
          href="/staff/products"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back
        </Link>
      </div>

      {brands.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Create a brand before adding products.
          </p>
          <CreateBrandForm action={createBrandAction} />
        </div>
      ) : (
        <ProductForm
          action={createProductAction}
          brands={brands}
          submitLabel="Create product"
        />
      )}
    </div>
  );
}
