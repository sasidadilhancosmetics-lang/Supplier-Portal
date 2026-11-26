import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { createBrandAction } from "@/app/staff/products/actions";
import { CreateBrandForm } from "@/components/staff/create-brand-form";
import { ProductMasterBadge } from "@/components/staff/product-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { listBrandsForCompany } from "@/lib/brands/queries";
import { isProductDomainError } from "@/lib/products/errors";
import { listProducts } from "@/lib/products/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Products",
  description: "Product master for the purchasing company.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{
    q?: string;
    brandId?: string;
    masterStatus?: string;
    page?: string;
  }>;
};

async function ProductList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  let result: Awaited<ReturnType<typeof listProducts>> | null = null;
  let brands: { id: string; name: string }[] = [];
  let errorMessage: string | null = null;

  try {
    [result, brands] = await Promise.all([
      listProducts(params),
      listBrandsForCompany(),
    ]);
  } catch (error) {
    errorMessage = isProductDomainError(error)
      ? error.message
      : "Unable to load products.";
  }

  if (errorMessage || !result) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {errorMessage ?? "Unable to load products."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {brands.length === 0 ? (
        <CreateBrandForm action={createBrandAction} />
      ) : null}

      <form
        method="get"
        action="/staff/products"
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            name="q"
            defaultValue={result.q}
            placeholder="Name, SKU, or ERP id"
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Brand</span>
          <select
            name="brandId"
            defaultValue={result.brandId ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Master</span>
          <select
            name="masterStatus"
            defaultValue={result.masterStatus ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="PROVISIONAL">Provisional</option>
            <option value="ERP_LINKED">ERP linked</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className={cn(buttonVariants({ className: "min-h-11 w-full" }))}
          >
            Apply
          </button>
        </div>
      </form>

      {result.items.length === 0 ? (
        <div className="rounded-lg border bg-muted px-4 py-6 text-sm">
          No products match. Product references arrive through Cosmo OSF imports.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Brand</th>
                <th className="px-3 py-3 font-medium">SKU</th>
                <th className="px-3 py-3 font-medium">ERP Item ID</th>
                <th className="px-3 py-3 font-medium">Priority</th>
                <th className="px-3 py-3 font-medium">Master</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((product) => (
                <tr key={product.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <Link
                      href={`/staff/products/${product.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {product.name}
                    </Link>
                    {!product.isActive ? (
                      <span className="ml-2 text-muted-foreground">
                        (inactive)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {product.brand.name}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {product.sku ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {product.erpItemId ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {product.priorityStatus}
                  </td>
                  <td className="px-3 py-3">
                    <ProductMasterBadge status={product.masterStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          Page {result.page} of {result.pageCount} · {result.total} total
        </p>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Link
              href={`/staff/products?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.brandId ? { brandId: result.brandId } : {}),
                ...(result.masterStatus
                  ? { masterStatus: result.masterStatus }
                  : {}),
                page: String(result.page - 1),
              }).toString()}`}
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Previous
            </Link>
          ) : null}
          {result.page < result.pageCount ? (
            <Link
              href={`/staff/products?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.brandId ? { brandId: result.brandId } : {}),
                ...(result.masterStatus
                  ? { masterStatus: result.masterStatus }
                  : {}),
                page: String(result.page + 1),
              }).toString()}`}
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Product references arrive from Cosmo OSF imports. Review an import
            before confirming it for supplier access.
          </p>
        </div>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading products…</p>
        }
      >
        <ProductList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
