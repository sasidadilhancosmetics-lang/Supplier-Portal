import { rethrowPageAuthError } from "@/lib/auth/page";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { isRequestDomainError } from "@/lib/requests/errors";
import { listSupplierRequestsForSupplier } from "@/lib/requests/supplier-queries";
import { supplierRequestListAction } from "@/lib/supplier/request-list-actions";
import { supplierRequestStatusLabel } from "@/lib/supplier/request-labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Requests",
  description: "Supplier requests awaiting your availability response.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string; flash?: string }>;
};

async function FlashBanner({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  if (params.flash !== "availability-submitted") return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground"
    >
      Response submitted. You can reopen a request anytime to update quantity or
      delivery date.
    </p>
  );
}

async function RequestList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  // Default to Need Reply so busy suppliers see pending work first.
  const statusParam = params.status ?? "ACTION_REQUIRED";
  let result;
  try {
    result = await listSupplierRequestsForSupplier({
      ...params,
      status: statusParam,
    });
  } catch (error) {
    rethrowPageAuthError(error);
    return (
      <p role="alert" className="text-sm text-destructive">
        {isRequestDomainError(error)
          ? error.message
          : "Unable to load requests."}
      </p>
    );
  }

  const activeFilter = result.status ?? statusParam;
  const isNeedReply = activeFilter === "ACTION_REQUIRED";

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Request filters"
      >
        <Link
          href="/supplier/requests?status=ACTION_REQUIRED"
          role="tab"
          aria-selected={isNeedReply}
          className={cn(
            buttonVariants({
              variant: isNeedReply ? "default" : "outline",
              className: "min-h-11",
            }),
          )}
        >
          Need Reply
        </Link>
        <Link
          href="/supplier/requests?status=ALL"
          role="tab"
          aria-selected={!isNeedReply}
          className={cn(
            buttonVariants({
              variant: !isNeedReply ? "default" : "outline",
              className: "min-h-11",
            }),
          )}
        >
          All Requests
        </Link>
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-6" role="status">
          <p className="font-medium">
            {isNeedReply ? "You're all caught up!" : "No requests yet."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isNeedReply
              ? "Nothing needs a reply right now. Switch to All Requests to review past responses."
              : "New availability requests will show up here."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((row) => {
            const action = supplierRequestListAction({
              id: row.id,
              status: row.status,
              hasPendingCounter: row.hasPendingCounter,
            });
            return (
              <li key={row.id}>
                <Link
                  href={action.href}
                  className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-medium">{row.brand.name}</p>
                        <Badge variant="outline">
                          {supplierRequestStatusLabel(row.status)}
                        </Badge>
                        {row.hasPendingCounter ? (
                          <Badge>Price reply needed</Badge>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <p>
                          {row.itemCount} item
                          {row.itemCount === 1 ? "" : "s"}
                        </p>
                        {row.sentAt ? (
                          <p className="mt-0.5">
                            Sent {formatDateTime(row.sentAt)}
                          </p>
                        ) : null}
                        {row.responseDeadline ? (
                          <p className="mt-0.5">
                            Reply by {formatDateTime(row.responseDeadline)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={cn(
                        buttonVariants({
                          variant:
                            action.label === "View Response"
                              ? "outline"
                              : "default",
                          className:
                            "pointer-events-none min-h-11 w-full shrink-0 sm:w-auto",
                        }),
                      )}
                    >
                      {action.label}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function SupplierRequestsPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 sm:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Requests
        </h1>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Reply with quantity, date, and price when needed.
        </p>
      </div>
      <Suspense fallback={null}>
        <FlashBanner searchParams={searchParams} />
      </Suspense>
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <RequestList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
