import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PendingRegistrationsPanel } from "@/components/admin/pending-registrations-panel";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { isSupplierDomainError } from "@/lib/suppliers/errors";
import { listPendingSelfRegistrations } from "@/lib/suppliers/registration";
import { listSuppliersForAdmin } from "@/lib/suppliers/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Suppliers",
  description: "Search and manage purchasing-company suppliers.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
  }>;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(value);
}

async function SupplierList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;

  let result: Awaited<ReturnType<typeof listSuppliersForAdmin>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await listSuppliersForAdmin(params);
  } catch (error) {
    errorMessage = isSupplierDomainError(error)
      ? error.message
      : "Unable to load suppliers.";
  }

  if (errorMessage || !result) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {errorMessage ?? "Unable to load suppliers."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        method="get"
        action="/admin/suppliers"
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto]"
      >
        {/* Applying filters always starts at page 1 (omit previous page). */}
        <input type="hidden" name="page" value="1" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            name="q"
            defaultValue={result.q}
            placeholder="Name or contact"
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            name="status"
            defaultValue={result.status ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_REVIEW">Pending review</option>
            <option value="INACTIVE">Inactive</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className={cn(buttonVariants({ className: "min-h-11 w-full" }))}
          >
            Apply
          </button>
        </div>
      </form>

      {result.items.length === 0 ? (
        <div className="rounded-lg border bg-muted px-4 py-6 text-sm leading-6">
          No suppliers match these filters.{" "}
          <Link
            href="/admin/suppliers/new"
            className="underline underline-offset-4"
          >
            Add a supplier
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Supplier</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Brands</th>
                <th className="px-3 py-3 font-medium">Contact</th>
                <th className="px-3 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((supplier) => (
                <tr key={supplier.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/suppliers/${supplier.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {supplier.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <SupplierStatusBadge status={supplier.status} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {supplier.supportsAllBrands
                      ? "All brands"
                      : supplier.brands.length > 0
                        ? supplier.brands.map((b) => b.name).join(", ")
                        : "—"}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <div className="flex flex-col">
                      <span>{supplier.contactName ?? "—"}</span>
                      <span>
                        {supplier.contactEmail ?? supplier.contactPhone ?? ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(supplier.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          Page {result.page} of {result.pageCount} · {result.total} total
        </p>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Link
              href={`/admin/suppliers?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.status ? { status: result.status } : {}),
                page: String(result.page - 1),
              }).toString()}`}
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Previous
            </Link>
          ) : null}
          {result.page < result.pageCount ? (
            <Link
              href={`/admin/suppliers?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.status ? { status: result.status } : {}),
                page: String(result.page + 1),
              }).toString()}`}
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function PendingRegistrationsSection() {
  let registrations: Awaited<ReturnType<typeof listPendingSelfRegistrations>> =
    [];
  try {
    registrations = await listPendingSelfRegistrations();
  } catch {
    registrations = [];
  }
  return <PendingRegistrationsPanel registrations={registrations} />;
}

export default function AdminSuppliersPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Suppliers</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Search, filter, and open supplier company records for this purchasing
            company.
          </p>
        </div>
        <Link
          href="/admin/suppliers/new"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Add supplier
        </Link>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">
            Loading pending registrations…
          </p>
        }
      >
        <PendingRegistrationsSection />
      </Suspense>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading suppliers…</p>
        }
      >
        <SupplierList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
