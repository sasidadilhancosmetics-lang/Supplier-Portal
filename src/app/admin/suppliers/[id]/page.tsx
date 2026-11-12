import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  changeSupplierStatusAction,
  updateSupplierAction,
} from "@/app/admin/suppliers/actions";
import { RegistrationReviewPanel } from "@/components/admin/registration-review-panel";
import { SupplierForm } from "@/components/admin/supplier-form";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { SupplierStatusForm } from "@/components/admin/supplier-status-form";
import { SupplierUsersPanel } from "@/components/admin/supplier-users-panel";
import { buttonVariants } from "@/components/ui/button";
import { listSupplierUsersForAdmin } from "@/lib/invitations/service";
import { isSupplierDomainError } from "@/lib/suppliers/errors";
import {
  getSupplierForAdmin,
  listBrandsForAdminCompany,
} from "@/lib/suppliers/queries";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  try {
    const { id } = await params;
    const supplier = await getSupplierForAdmin(id);
    return {
      title: supplier.name,
      description: `Supplier company profile for ${supplier.name}.`,
    };
  } catch {
    return { title: "Supplier" };
  }
}

export default async function SupplierDetailPage({ params }: PageProps) {
  const { id } = await params;

  let supplier;
  let brands;
  let usersPanel;
  try {
    [supplier, brands, usersPanel] = await Promise.all([
      getSupplierForAdmin(id),
      listBrandsForAdminCompany(),
      listSupplierUsersForAdmin(id),
    ]);
  } catch (error) {
    if (isSupplierDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

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
            Edit company profile and brand membership. Profile edits do not
            require approval.
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

      <RegistrationReviewPanel
        supplierId={supplier.id}
        status={supplier.status}
        registrationSource={supplier.registrationSource}
        rejectionReason={supplier.rejectionReason}
      />

      {!(
        supplier.registrationSource === "SELF" &&
        supplier.status === "PENDING_REVIEW"
      ) ? (
        <SupplierStatusForm
          supplierId={supplier.id}
          currentStatus={supplier.status}
          action={changeSupplierStatusAction}
        />
      ) : null}

      <SupplierUsersPanel
        supplierId={supplier.id}
        users={usersPanel.users}
        invitations={usersPanel.invitations}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Company profile</h2>
        <SupplierForm
          action={updateSupplierAction}
          brands={brands}
          supplierId={supplier.id}
          submitLabel="Save changes"
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
            brandIds: supplier.brands.map((brand) => brand.id),
          }}
        />
      </section>
    </div>
  );
}
