import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AllocateForm } from "@/components/staff/allocate-form";
import { buttonVariants } from "@/components/ui/button";
import { OrderDomainError } from "@/lib/orders/errors";
import { listAllocatableOffersForRequest } from "@/lib/orders/queries";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Allocate order" };

type PageProps = {
  searchParams: Promise<{ requestId?: string }>;
};

export default async function AllocateOrderPage({ searchParams }: PageProps) {
  const { requestId } = await searchParams;
  if (!requestId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Allocate order</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Choose a supplier request with submitted availability and an active
          reserve, then use Allocate order from the review page.
        </p>
        <Link
          href="/staff/requests"
          className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
        >
          Supplier requests
        </Link>
      </div>
    );
  }

  let result;
  try {
    result = await listAllocatableOffersForRequest(requestId);
  } catch (error) {
    if (error instanceof OrderDomainError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Allocate order
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Create a purchase order from submitted availability with an active
            reserve for {result.supplier.name}.
          </p>
        </div>
        <Link
          href={`/staff/requests/${result.id}`}
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back to request
        </Link>
      </div>

      {result.allocatableLines.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            No lines are allocatable right now. Allocation requires submitted
            availability, a live reserve, and remaining quantity.
          </p>
          {result.skipped.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.skipped.map((row) => (
                <li key={`${row.productName}-${row.reason}`}>
                  {row.productName}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <AllocateForm
          supplierId={result.supplierId}
          supplierName={result.supplier.name}
          requestId={result.id}
          lines={result.allocatableLines}
        />
      )}
    </div>
  );
}
