import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RequirementStatusBadge } from "@/components/staff/requirement-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { isAuthorizationError } from "@/lib/auth/errors";
import { isRequirementDomainError } from "@/lib/requirements/errors";
import { loadRequirementsIndexPage } from "@/lib/requirements/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Requirements",
  description: "Draft and confirm purchasing requirements.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    brandId?: string;
    page?: string;
  }>;
};

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value);
}

async function RequirementList({
  searchParams,
}: {
  searchParams: PageProps["searchParams"];
}) {
  const params = await searchParams;
  let result: Awaited<
    ReturnType<typeof loadRequirementsIndexPage>
  >["result"] | null = null;
  let brands: { id: string; name: string }[] = [];
  let errorMessage: string | null = null;

  try {
    ({ result, brands } = await loadRequirementsIndexPage(params));
  } catch (error) {
    if (isRequirementDomainError(error)) {
      errorMessage = error.message;
    } else if (isAuthorizationError(error)) {
      errorMessage = "You do not have permission to view requirements.";
    } else {
      console.error("[staff/requirements] load failed", error);
      errorMessage = "Unable to load requirements.";
    }
  }

  if (errorMessage || !result) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {errorMessage ?? "Unable to load requirements."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        method="get"
        action="/staff/requirements"
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <input type="hidden" name="page" value="1" />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            name="q"
            defaultValue={result.q}
            placeholder="Title, notes, or id"
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
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
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Brand</span>
          <select
            name="brandId"
            defaultValue={result.brandId ?? ""}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
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
        <div className="rounded-lg border bg-muted px-4 py-6 text-sm">
          No requirements yet.{" "}
          <Link
            href="/staff/requirements/new"
            className="underline underline-offset-4"
          >
            Create a draft
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Requirement</th>
                <th className="px-3 py-3 font-medium">Brand</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Items</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <Link
                      href={`/staff/requirements/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.title?.trim() || row.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.brand.name}
                  </td>
                  <td className="px-3 py-3">
                    <RequirementStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {row.itemCount}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(row.confirmedAt)}
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
              href={`/staff/requirements?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.status ? { status: result.status } : {}),
                ...(result.brandId ? { brandId: result.brandId } : {}),
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
              href={`/staff/requirements?${new URLSearchParams({
                ...(result.q ? { q: result.q } : {}),
                ...(result.status ? { status: result.status } : {}),
                ...(result.brandId ? { brandId: result.brandId } : {}),
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

export default function RequirementsPage({ searchParams }: PageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Requirements
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Create draft requirements, confirm them, then distribute supplier
            requests and allocate purchase orders from responses.
          </p>
        </div>
        <Link
          href="/staff/requirements/new"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          New draft
        </Link>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading requirements…</p>
        }
      >
        <RequirementList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
