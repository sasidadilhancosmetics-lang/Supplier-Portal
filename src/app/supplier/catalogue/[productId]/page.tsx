import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogueCard } from "@/components/supplier/catalogue-card";
import { formatDateTime } from "@/lib/dates";
import { getSupplierCatalogueProduct } from "@/lib/supplier/catalogue";
import { formatCataloguePrice } from "@/lib/supplier/catalogue-price-format";

export const instant = false;

export default async function CatalogueProductPage({ params, searchParams }: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const cursor = Number(query.before);
  const detail = await getSupplierCatalogueProduct(productId, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  if (!detail) notFound();
  return (
    <div className="min-w-0 space-y-4">
      <Link href="/supplier/catalogue" className="inline-flex min-h-11 items-center underline">Back to catalogue</Link>
      <h1 className="text-2xl font-semibold">Product price</h1>
      <CatalogueCard product={detail.product} showDetailLink={false} />
      <section className="space-y-2" aria-labelledby="price-history">
        <h2 id="price-history" className="text-lg font-medium">Price history</h2>
        {!detail.history.length ? <p className="text-sm text-muted-foreground">No prices saved.</p> : (
          <ul className="divide-y rounded-md border px-3">
            {detail.history.map((entry) => (
              <li key={entry.revision} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <span>{formatCataloguePrice(entry)}</span>
                <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.nextBefore ? <Link className="inline-flex min-h-11 items-center underline" href={`?before=${detail.nextBefore}`}>Older prices</Link> : null}
      </section>
    </div>
  );
}
