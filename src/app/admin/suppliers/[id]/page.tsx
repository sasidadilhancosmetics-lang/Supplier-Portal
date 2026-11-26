import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  changeSupplierStatusAction,
  updateSupplierAction,
  updateSupplierExternalIdAction,
} from "@/app/admin/suppliers/actions";
import { RegistrationReviewPanel } from "@/components/admin/registration-review-panel";
import { CatalogueExclusionControls, CataloguePhotoBatchControl } from "@/components/admin/catalogue-exclusion-controls";
import { SupplierCosmoIdForm } from "@/components/admin/supplier-cosmo-id-form";
import { SupplierForm } from "@/components/admin/supplier-form";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { SupplierStatusForm } from "@/components/admin/supplier-status-form";
import { SupplierUsersPanel } from "@/components/admin/supplier-users-panel";
import { buttonVariants } from "@/components/ui/button";
import { listSupplierUsersForAdmin } from "@/lib/invitations/service";
import { searchCatalogueExclusions } from "@/lib/supplier/catalogue-admin";
import { isSupplierDomainError } from "@/lib/suppliers/errors";
import {
  getSupplierForAdmin,
  listBrandsForAdminCompany,
} from "@/lib/suppliers/queries";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ catalogueSku?: string }>;
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

export default async function SupplierDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { catalogueSku } = await searchParams;
  const catalogueSearch = typeof catalogueSku === "string" ? catalogueSku.trim().slice(0, 100) : "";

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
  const catalogueProducts = await searchCatalogueExclusions(supplier.id, catalogueSearch);

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

      <SupplierCosmoIdForm
        supplierId={supplier.id}
        currentExternalId={supplier.externalId}
        action={updateSupplierExternalIdAction}
      />

      <SupplierUsersPanel
        supplierId={supplier.id}
        users={usersPanel.users}
        invitations={usersPanel.invitations}
      />

      <section id="catalogue" className="space-y-3">
        <h2 className="text-lg font-medium">Catalogue exclusions</h2>
        <CataloguePhotoBatchControl />
        <form method="get" action={`/admin/suppliers/${encodeURIComponent(supplier.id)}#catalogue`} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            Search SKU or product
            <input name="catalogueSku" defaultValue={catalogueSearch} maxLength={100} className="min-h-11 rounded-md border bg-background px-3" />
          </label>
          <button className="min-h-11 rounded-md border px-3 text-sm">Search</button>
        </form>
        {!catalogueProducts.length ? <p className="text-sm text-muted-foreground">{catalogueSearch ? "No matching products." : "No exclusions or photos awaiting review."}</p> : (
          <ul className="space-y-2">
            {catalogueProducts.slice(0, 25).map((product) => (
              <li key={product.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-muted-foreground">{product.sku ?? "No SKU"}{product.hidden ? " · Hidden" : ""}</p>
                  {product.photoStatus === "NEEDS_REVIEW" ? <p className="text-sm">Photo needs review</p> : null}
                  {product.photoStale ? <p className="text-sm">Photo refresh failed</p> : null}
                </div>
                <CatalogueExclusionControls supplierId={supplier.id} productId={product.id} hidden={product.hidden} needsReview={product.photoStatus === "NEEDS_REVIEW"} />
              </li>
            ))}
          </ul>
        )}
        {catalogueProducts.length > 25 ? <p className="text-sm">Narrow your search to see more products.</p> : null}
      </section>

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
