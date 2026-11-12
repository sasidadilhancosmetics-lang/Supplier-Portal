import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updateProductAction } from "@/app/staff/products/actions";
import { ProductForm } from "@/components/staff/product-form";
import { ProductMasterBadge } from "@/components/staff/product-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { listBrandsForCompany } from "@/lib/brands/queries";
import { isProductDomainError } from "@/lib/products/errors";
import { getProduct } from "@/lib/products/queries";
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
    const product = await getProduct(id);
    return { title: product.name };
  } catch {
    return { title: "Product" };
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  let product;
  let brands;
  try {
    [product, brands] = await Promise.all([
      getProduct(id),
      listBrandsForCompany(),
    ]);
  } catch (error) {
    if (isProductDomainError(error) && error.code === "NOT_FOUND") {
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
              {product.name}
            </h1>
            <ProductMasterBadge status={product.masterStatus} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Edit permitted fields. Master status and ERP identifiers are
            preserved and cannot be invented from this form.
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

      <ProductForm
        action={updateProductAction}
        brands={brands}
        productId={product.id}
        submitLabel="Save changes"
        defaults={{
          name: product.name,
          brandId: product.brandId,
          sku: product.sku,
          unitOfMeasure: product.unitOfMeasure,
          priorityStatus: product.priorityStatus,
          isActive: product.isActive,
        }}
        readOnlyMaster={{
          masterStatus: product.masterStatus,
          erpItemId: product.erpItemId,
          cosmoItemId: product.cosmoItemId,
        }}
      />
    </div>
  );
}
