import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isAuthorizationError } from "@/lib/auth/errors";
import { canStaffPermission } from "@/lib/auth/guards";
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
    if (
      (isRequestDomainError(error) && error.code === "NOT_FOUND") ||
      (isAuthorizationError(error) && error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }

  const canAllocate = await canStaffPermission("ALLOCATE_ORDER");
  const eligibleCount = request.lines.filter(
    (line) => line.reserveValid && Number(line.remainingAllocatable) > 0,
  ).length;
  const allocateHref = `/staff/orders/allocate?requestId=${request.id}`;

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
            staff cannot edit them here. Allocate only from submitted lines with
            an active reserve.
          </p>
          <p className="text-sm text-muted-foreground">
            Sent {formatDateTime(request.sentAt)} · Deadline{" "}
            {formatDateTime(request.responseDeadline)} · Responded{" "}
            {formatDateTime(request.respondedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAllocate ? (
            eligibleCount > 0 ? (
              <Link
                href={allocateHref}
                className={cn(buttonVariants({ className: "min-h-11" }))}
              >
                Allocate order
              </Link>
            ) : (
              <span
                className={cn(
                  buttonVariants({ className: "min-h-11 pointer-events-none opacity-50" }),
                )}
                title="No submitted availability with an active reserve and remaining quantity"
                aria-disabled
              >
                Allocate order
              </span>
            )
          ) : null}
          <Link
            href="/staff/requests"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Back
          </Link>
        </div>
      </div>

      {canAllocate && eligibleCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Allocation is unavailable until at least one line has submitted
          availability, a live reserve, and remaining quantity.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 font-medium">Requested</th>
              <th className="px-3 py-3 font-medium">Availability</th>
              <th className="px-3 py-3 font-medium">Price</th>
              <th className="px-3 py-3 font-medium">Remaining</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Reserve</th>
              <th className="px-3 py-3 font-medium">Shortage</th>
            </tr>
          </thead>
          <tbody>
            {request.lines.map((line) => {
              const allocatable =
                line.reserveValid && Number(line.remainingAllocatable) > 0;
              return (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{line.product.name}</div>
                    <div className="text-muted-foreground">
                      {line.product.sku ?? "—"} · {line.product.priorityStatus}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <Link
                        href={`/staff/products/${line.product.id}/prices`}
                        className="underline underline-offset-2"
                      >
                        Compare
                      </Link>
                      {line.offer?.id ? (
                        <Link
                          href={`/staff/offers/${line.offer.id}/negotiate`}
                          className="underline underline-offset-2"
                        >
                          Negotiate
                        </Link>
                      ) : null}
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
                  <td className="px-3 py-3">
                    {line.offer?.priceAgreement ? (
                      <>
                        <div>
                          {line.offer.priceAgreement.unitPrice} LKR
                        </div>
                        <Badge variant="outline" className="mt-1">
                          {line.offer.priceAgreement.status}
                        </Badge>
                      </>
                    ) : line.offer?.unitPrice ? (
                      `${line.offer.unitPrice} LKR`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {allocatable ? (
                      line.remainingAllocatable
                    ) : (
                      <span className="text-muted-foreground">
                        {line.offer?.status === "EXPIRED"
                          ? "Expired"
                          : line.offer?.status === "CANCELLED"
                            ? "Cancelled"
                            : line.offer?.status === "NOT_AVAILABLE"
                              ? "Unavailable"
                              : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {line.offer?.splits.length ? (
                      <ul className="space-y-1">
                        {line.offer.splits.map((split) => (
                          <li key={split.date}>{split.quantity} · {formatCalendarDate(split.date)}</li>
                        ))}
                      </ul>
                    ) : formatCalendarDate(line.offer?.availableDate ?? null)}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
