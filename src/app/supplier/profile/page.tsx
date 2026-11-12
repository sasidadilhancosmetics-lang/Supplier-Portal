import type { Metadata } from "next";
import Link from "next/link";

import { updateOwnSupplierProfileAction } from "@/app/supplier/profile/actions";
import { SupplierForm } from "@/components/admin/supplier-form";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { getOwnSupplierProfile } from "@/lib/suppliers/supplier-self";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Company profile",
  description: "Edit your supplier company details.",
};

export const instant = false;

export default async function SupplierProfilePage() {
  const { supplier, brands } = await getOwnSupplierProfile();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {supplier.name}
            </h1>
            <SupplierStatusBadge status={supplier.status} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Update your company profile and brand membership. Status is managed
            by the purchasing company and cannot be changed here.
          </p>
        </div>
        <Link
          href="/supplier"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Supplier home
        </Link>
      </div>

      <SupplierForm
        action={updateOwnSupplierProfileAction}
        brands={brands}
        submitLabel="Save profile"
        defaults={{
          name: supplier.name,
          contactName: supplier.contactName,
          contactEmail: supplier.contactEmail,
          contactPhone: supplier.contactPhone,
          addressLine1: supplier.addressLine1,
          addressLine2: supplier.addressLine2,
          city: supplier.city,
          region: supplier.region,
          postalCode: supplier.postalCode,
          country: supplier.country,
          notes: supplier.notes,
          supportsAllBrands: supplier.supportsAllBrands,
          brandIds: supplier.brandIds,
        }}
      />
    </div>
  );
}
