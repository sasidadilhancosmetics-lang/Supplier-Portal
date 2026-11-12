import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DistributeForm } from "@/components/staff/distribute-form";
import { buttonVariants } from "@/components/ui/button";
import {
  isRequestDomainError,
} from "@/lib/requests/errors";
import { listMatchingSuppliersForRequirement } from "@/lib/requests/distribute";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = {
  title: "Distribute to suppliers",
};

export default async function DistributeRequirementPage({ params }: PageProps) {
  const { id } = await params;
  let preview;
  try {
    preview = await listMatchingSuppliersForRequirement(id);
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
          <h1 className="text-3xl font-semibold tracking-tight">
            Send supplier requests
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            {preview.requirement.title?.trim() || "Requirement"} · Brand{" "}
            {preview.requirement.brand.name}. Preview recipients, then send.
          </p>
        </div>
        <Link
          href={`/staff/requirements/${id}`}
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Back
        </Link>
      </div>

      <section className="rounded-lg border p-4 text-sm">
        <h2 className="font-medium">Request items</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {preview.requirement.items.map((item) => (
            <li key={item.id}>
              {item.product.name}
              {item.product.sku ? ` (${item.product.sku})` : ""} — qty{" "}
              {item.quantityPlanned} · {item.product.priorityStatus}
            </li>
          ))}
        </ul>
      </section>

      <DistributeForm
        requirementId={preview.requirement.id}
        suppliers={preview.suppliers}
      />
    </div>
  );
}
