import { loadProtectedPage } from "@/lib/auth/page";
import type { Metadata } from "next";
import Link from "next/link";

import { CatalogueCard } from "@/components/supplier/catalogue-card";
import { CatalogueSearch } from "@/components/supplier/catalogue-search";
import { listSupplierCatalogue } from "@/lib/supplier/catalogue";

export const metadata: Metadata = { title: "Catalogue" };
export const instant = false;

export default async function CataloguePage({ searchParams }: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const number = Number(params.page);
  const page = Number.isInteger(number) ? Math.min(1000, Math.max(1, number)) : 1;
  const { importId, products, hasMore } = await loadProtectedPage(() => listSupplierCatalogue(search, page));
  const pageHref = (value: number) => `/supplier/catalogue?${new URLSearchParams({ q: search, page: String(value) })}`;
  return (
    <div className="min-w-0 space-y-5">
      <h1 className="text-2xl font-semibold sm:text-3xl">Catalogue</h1>
      <CatalogueSearch search={search} page={page} />
      {!importId ? <p role="status">Catalogue not ready yet.</p> : null}
      {importId && !products.length ? (
        <div className="space-y-2" role="status">
          <p>{search ? "No products match your search." : "No products available for your selected brands."}</p>
          <Link className="inline-flex min-h-11 items-center underline" href="/supplier/profile">Select brands in your profile</Link>
        </div>
      ) : null}
      {importId && products.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {products.map((product) => <CatalogueCard key={product.productId} product={product} />)}
        </div>
      ) : null}
      {page > 1 || hasMore ? (
        <nav aria-label="Catalogue pages" className="flex gap-4">
          {page > 1 ? <Link className="inline-flex min-h-11 items-center underline" href={pageHref(page - 1)}>Previous</Link> : null}
          {hasMore && page < 1000 ? <Link className="inline-flex min-h-11 items-center underline" href={pageHref(page + 1)}>Next</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
