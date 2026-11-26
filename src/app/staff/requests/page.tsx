import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { isRequestDomainError } from "@/lib/requests/errors";
import { listCompanySupplierRequests } from "@/lib/requests/company-queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Supplier requests",
  description: "Company review of sent supplier requests and availability.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string; distributed?: string }>;
};

async function RequestList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  let result: Awaited<ReturnType<typeof listCompanySupplierRequests>> | null =
    null;
  let errorMessage: string | null = null;
  try {
    result = await listCompanySupplierRequests(params);
  } catch (error) {
    errorMessage = isRequestDomainError(error)
      ? error.message
      : "Unable to load requests.";
  }

  if (errorMessage || !result) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {params.distributed ? (
        <p role="status" className="rounded-lg border bg-muted px-4 py-3 text-sm">
          Sent {params.distributed} supplier request(s).
        </p>
      ) : null}

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            name="status"
            defaultValue={result.status ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="NEW">New</option>
            <option value="PARTIALLY_RESPONDED">Partially responded</option>
            <option value="RESPONDED">Responded</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <button
          type="submit"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Apply
        </button>
      </form>

      {result.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No supplier requests yet. Confirm a requirement, then distribute.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Supplier</th>
                <th className="px-3 py-3 font-medium">Requirement</th>
                <th className="px-3 py-3 font-medium">Brand</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Sent</th>
                <th className="px-3 py-3 font-medium">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <Link
                      href={`/staff/requests/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.supplier.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.requirement.title?.trim() || row.requirement.id}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.brandName}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="outline">{row.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(row.sentAt)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(row.responseDeadline)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function StaffRequestsPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Supplier requests
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Review sent requests, pending responses, and submitted availability.
          Open a request to allocate an order from lines with an active reserve.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <RequestList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
