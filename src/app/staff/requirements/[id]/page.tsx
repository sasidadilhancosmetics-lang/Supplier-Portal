import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RequirementDraftEditor } from "@/components/staff/requirement-draft-editor";
import { RequirementStatusBadge } from "@/components/staff/requirement-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { isRequirementDomainError } from "@/lib/requirements/errors";
import {
  getRequirement,
  listActiveProductsForBrand,
} from "@/lib/requirements/queries";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  try {
    const { id } = await params;
    const requirement = await getRequirement(id);
    return {
      title: requirement.title?.trim() || "Requirement",
    };
  } catch {
    return { title: "Requirement" };
  }
}

export default async function RequirementDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const errorMessage =
    typeof query.error === "string" ? query.error.slice(0, 300) : null;

  let requirement;
  let products;
  try {
    requirement = await getRequirement(id);
    products = await listActiveProductsForBrand(requirement.brandId);
  } catch (error) {
    if (isRequirementDomainError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const isDraft = requirement.status === "DRAFT";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {requirement.title?.trim() || "Untitled requirement"}
            </h1>
            <RequirementStatusBadge status={requirement.status} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Brand: {requirement.brand.name}.{" "}
            {isDraft
              ? "Edit draft items, then confirm when ready."
              : "Confirmed requirements are read-only. Distribute to matching suppliers to collect availability."}
          </p>
          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isDraft ? (
            <Link
              href={`/staff/requirements/${requirement.id}/distribute`}
              className={cn(buttonVariants({ className: "min-h-11" }))}
            >
              Distribute
            </Link>
          ) : null}
          <Link
            href="/staff/requirements"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Back
          </Link>
        </div>
      </div>

      {isDraft ? (
        <RequirementDraftEditor
          requirementId={requirement.id}
          title={requirement.title}
          notes={requirement.notes}
          products={products}
          items={requirement.items.map((item) => ({
            id: item.id,
            quantityPlanned: item.quantityPlanned.toString(),
            notes: item.notes,
            product: item.product,
          }))}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {requirement.notes ? (
            <p className="text-sm text-muted-foreground">{requirement.notes}</p>
          ) : null}
          {requirement.confirmedAt ? (
            <p className="text-sm text-muted-foreground">
              Confirmed{" "}
              {new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(requirement.confirmedAt)}
              {requirement.confirmedBy
                ? ` by ${requirement.confirmedBy.email}`
                : ""}
              .
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-3 font-medium">Product</th>
                  <th className="px-3 py-3 font-medium">SKU</th>
                  <th className="px-3 py-3 font-medium">ERP Item ID</th>
                  <th className="px-3 py-3 font-medium">Priority</th>
                  <th className="px-3 py-3 font-medium">Master</th>
                  <th className="px-3 py-3 font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {requirement.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-3 py-3 font-medium">
                      {item.product.name}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {item.product.sku ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {item.product.erpItemId ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {item.product.priorityStatus}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {item.product.masterStatus}
                    </td>
                    <td className="px-3 py-3">
                      {item.quantityPlanned.toString()}
                      {item.product.unitOfMeasure
                        ? ` ${item.product.unitOfMeasure}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
