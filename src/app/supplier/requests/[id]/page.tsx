import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AvailabilityForm } from "@/components/supplier/availability-form";
import { PriceCounterResponse } from "@/components/supplier/price-counter-response";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { getSupplierRequestForSupplier } from "@/lib/requests/availability";
import { isRequestDomainError } from "@/lib/requests/errors";
import { supplierRequestStatusLabel } from "@/lib/supplier/request-labels";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    focus?: string;
    offer?: string;
    flash?: string;
    price?: string;
    currency?: string;
  }>;
};

export const metadata: Metadata = { title: "Respond to request" };

export default async function SupplierRequestDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  let request;
  try {
    request = await getSupplierRequestForSupplier(id);
  } catch (error) {
    if (isRequestDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const focusCounter = query.focus === "counter";
  const focusOfferId = query.offer ?? null;
  const priceAccepted = query.flash === "price-accepted";
  const acceptedPrice = query.price?.trim() || null;
  const acceptedCurrency = query.currency?.trim() || "LKR";

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {request.brand.name}
            </h1>
            <Badge variant="outline">
              {supplierRequestStatusLabel(request.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {request.items.length} item
            {request.items.length === 1 ? "" : "s"}
            {request.responseDeadline
              ? ` · Reply by ${formatDateTime(request.responseDeadline)}`
              : ""}
          </p>
        </div>
        <Link
          href="/supplier/requests"
          className={cn(
            buttonVariants({
              variant: "outline",
              className: "min-h-11 w-fit shrink-0",
            }),
          )}
        >
          Back
        </Link>
      </div>

      {priceAccepted && acceptedPrice ? (
        <p
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground"
        >
          Price agreed at {acceptedCurrency} {acceptedPrice}.
        </p>
      ) : null}

      {/* Pending counters stay visible even when availability was already submitted. */}
      <div id="price-counter-section">
        <PriceCounterResponse
          supplierRequestId={request.id}
          items={request.items}
          focusOfferId={focusOfferId}
          autoFocus={focusCounter}
        />
      </div>

      {/* Summary shows only when not editing — handled inside AvailabilityForm */}
      <AvailabilityForm
        supplierRequestId={request.id}
        items={request.items}
      />
    </div>
  );
}
