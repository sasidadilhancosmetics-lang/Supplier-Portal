import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { findProductPurchaseHistoryLink } from "@/lib/osf-imports/purchase-history";
import { getProductPriceComparison } from "@/lib/pricing/comparison";
import { isPricingDomainError } from "@/lib/pricing/errors";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Price comparison" };

export default async function ProductPriceComparisonPage({ params }: PageProps) {
  const { id } = await params;
  let comparison;
  try {
    comparison = await getProductPriceComparison(id);
  } catch (error) {
    if (isPricingDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const { product } = comparison;
  const purchaseHistoryLink = await findProductPurchaseHistoryLink(product.id, product.sku);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {product.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Company-scoped price comparison. Quoted history is separate from
            actual purchase order prices.
          </p>
          {purchaseHistoryLink && (
            <Link href={purchaseHistoryLink} className="inline-flex min-h-11 w-fit items-center underline">
              ERP purchase history
            </Link>
          )}
        </div>
        <Link
          href="/staff/requests"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back to requests
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Last actual PO price</p>
          <p className="mt-1 text-xl font-medium">
            {comparison.lastActualPurchaseOrderPrice
              ? `${comparison.lastActualPurchaseOrderPrice.unitPrice} LKR`
              : "—"}
          </p>
          {comparison.lastActualPurchaseOrderPrice ? (
            <p className="text-xs text-muted-foreground">
              {comparison.lastActualPurchaseOrderPrice.orderNumber} ·{" "}
              {comparison.lastActualPurchaseOrderPrice.supplier.name}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Lowest comparable historical
          </p>
          <p className="mt-1 text-xl font-medium">
            {comparison.lowestComparableHistoricalPrice.recommended
              ? `${comparison.lowestComparableHistoricalPrice.recommended.unitPrice} LKR`
              : "—"}
          </p>
          {comparison.lowestComparableHistoricalPrice.recommended ? (
            <p className="text-xs text-muted-foreground">
              Source:{" "}
              {comparison.lowestComparableHistoricalPrice.recommended.sourceType}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Live supplier offers</p>
          <p className="mt-1 text-xl font-medium">
            {comparison.currentOffers.length}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Current supplier prices</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Supplier</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Delivery</th>
                <th className="px-3 py-3 font-medium">Current</th>
                <th className="px-3 py-3 font-medium">Previous (same)</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {comparison.currentOffers.map((row) => (
                <tr key={row.availabilityOfferId} className="border-b last:border-0">
                  <td className="px-3 py-3 font-medium">{row.supplier.name}</td>
                  <td className="px-3 py-3">{row.quantityDeclared}</td>
                  <td className="px-3 py-3">
                    {formatCalendarDate(row.availableDate) || "—"}
                  </td>
                  <td className="px-3 py-3">
                    {row.agreement
                      ? `${row.agreement.unitPrice} LKR`
                      : row.offerUnitPrice
                        ? `${row.offerUnitPrice} LKR`
                        : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {row.previousPriceSameSupplier
                      ? `${row.previousPriceSameSupplier.unitPrice} LKR`
                      : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {row.agreement ? (
                      <Badge variant="outline">
                        {row.agreement.status}
                        {row.agreement.isAgreed ? " · agreed" : ""}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/staff/offers/${row.availabilityOfferId}/negotiate`}
                      className="underline underline-offset-2"
                    >
                      Negotiate
                    </Link>
                  </td>
                </tr>
              ))}
              {comparison.currentOffers.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-muted-foreground"
                  >
                    No live submitted offers for this product.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Historical quoted prices</h2>
          <ul className="flex flex-col gap-2">
            {comparison.quoteHistory.slice(0, 20).map((q) => (
              <li key={q.id} className="rounded-lg border px-4 py-3 text-sm">
                <div className="font-medium">
                  {q.unitPrice} LKR · {q.supplier.name}
                </div>
                <div className="text-muted-foreground">
                  {q.kind} · {q.status} · {formatDateTime(q.createdAt)}
                </div>
              </li>
            ))}
            {comparison.quoteHistory.length === 0 ? (
              <li className="text-sm text-muted-foreground">No quotes yet.</li>
            ) : null}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Actual purchased prices</h2>
          <ul className="flex flex-col gap-2">
            {comparison.purchasedHistory.slice(0, 20).map((p) => (
              <li key={p.id} className="rounded-lg border px-4 py-3 text-sm">
                <div className="font-medium">
                  {p.unitPrice} LKR · {p.supplier.name}
                </div>
                <div className="text-muted-foreground">
                  {p.orderNumber} · {p.poStatus} · {formatDateTime(p.createdAt)}
                </div>
              </li>
            ))}
            {comparison.purchasedHistory.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                No confirmed purchase prices yet.
              </li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
