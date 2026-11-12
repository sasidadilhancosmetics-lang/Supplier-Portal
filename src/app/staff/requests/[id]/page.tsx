import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { getCompanySupplierRequest } from "@/lib/requests/company-queries";
import { isRequestDomainError } from "@/lib/requests/errors";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Request review" };

export default async function CompanyRequestDetailPage({ params }: PageProps) {
  const { id } = await params;
  let request;
  try {
    request = await getCompanySupplierRequest(id);
  } catch (error) {
    if (isRequestDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {request.supplier.name}
            </h1>
            <Badge variant="outline">{request.status}</Badge>
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Brand {request.brand.name}. Quantities below are supplier-declared —
            staff cannot edit them here.
          </p>
          <p className="text-sm text-muted-foreground">
            Sent {formatDateTime(request.sentAt)} · Deadline{" "}
            {formatDateTime(request.responseDeadline)} · Responded{" "}
            {formatDateTime(request.respondedAt)}
          </p>
        </div>
        <Link
          href="/staff/requests"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 font-medium">Requested</th>
              <th className="px-3 py-3 font-medium">Availability</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Reserve expires</th>
              <th className="px-3 py-3 font-medium">Shortage</th>
            </tr>
          </thead>
          <tbody>
            {request.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="px-3 py-3">
                  <div className="font-medium">{line.product.name}</div>
                  <div className="text-muted-foreground">
                    {line.product.sku ?? "—"} · {line.product.priorityStatus}
                  </div>
                </td>
                <td className="px-3 py-3">{line.quantityRequested}</td>
                <td className="px-3 py-3">
                  {line.offer ? (
                    <>
                      <Badge variant="outline">{line.offer.status}</Badge>
                      <div className="mt-1">
                        {line.offer.status === "NOT_AVAILABLE"
                          ? "Not available"
                          : line.offer.quantityDeclared}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Pending</span>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatCalendarDate(line.offer?.availableDate ?? null)}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {line.reserveValid
                    ? formatDateTime(line.offer?.reserveExpiresAt ?? null)
                    : line.offer?.status === "EXPIRED"
                      ? "Expired"
                      : "—"}
                </td>
                <td className="px-3 py-3">{line.shortage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
