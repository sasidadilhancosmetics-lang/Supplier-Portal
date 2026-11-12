import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AvailabilityForm } from "@/components/supplier/availability-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { getSupplierRequestForSupplier } from "@/lib/requests/availability";
import { isRequestDomainError } from "@/lib/requests/errors";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Respond to request" };

export default async function SupplierRequestDetailPage({ params }: PageProps) {
  const { id } = await params;
  let request;
  try {
    request = await getSupplierRequestForSupplier(id);
  } catch (error) {
    if (isRequestDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Request response
            </h1>
            <Badge variant="outline">{request.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Deadline {formatDateTime(request.responseDeadline)}
          </p>
        </div>
        <Link
          href="/supplier/requests"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back
        </Link>
      </div>

      <AvailabilityForm
        supplierRequestId={request.id}
        items={request.items}
      />
    </div>
  );
}
