import type { Metadata } from "next";
import Link from "next/link";

import { SupplierForm } from "@/components/admin/supplier-form";
import { buttonVariants } from "@/components/ui/button";
import { createSupplierAction } from "@/app/admin/suppliers/actions";
import { listBrandsForAdminCompany } from "@/lib/suppliers/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Add supplier",
  description: "Create a supplier company record.",
};

export const instant = false;

export default async function NewSupplierPage() {
  const brands = await listBrandsForAdminCompany();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Add supplier</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Creates a supplier company in Pending review. User invites are not
            part of this stage.
          </p>
        </div>
        <Link
          href="/admin/suppliers"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back to list
        </Link>
      </div>

      <SupplierForm
        action={createSupplierAction}
        brands={brands}
        submitLabel="Create supplier"
        defaults={{ supportsAllBrands: false, brandIds: [], name: "" }}
      />
    </div>
  );
}
