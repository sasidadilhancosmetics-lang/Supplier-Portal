import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { isRequestDomainError } from "@/lib/requests/errors";
import { listSupplierRequestsForSupplier } from "@/lib/requests/supplier-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Requests",
  description: "Supplier requests awaiting your availability response.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>;
};

async function RequestList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  let result;
  try {
    result = await listSupplierRequestsForSupplier(params);
  } catch (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {isRequestDomainError(error)
          ? error.message
          : "Unable to load requests."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap gap-2">
        <select
          name="status"
          defaultValue={result.status ?? ""}
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
        >
          <option value="">All</option>
          <option value="NEW">New</option>
          <option value="PARTIALLY_RESPONDED">Partially responded</option>
          <option value="RESPONDED">Responded</option>
        </select>
        <button
          type="submit"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Filter
        </button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((row) => (
            <li key={row.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/supplier/requests/${row.id}`}
                  className="text-base font-medium underline-offset-4 hover:underline"
                >
                  {row.brand.name}
                </Link>
                <Badge variant="outline">{row.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {row.itemCount} items · Deadline{" "}
                {formatDateTime(row.responseDeadline)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SupplierRequestsPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Requests</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Respond with availability, delivery dates, or not available.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <RequestList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
