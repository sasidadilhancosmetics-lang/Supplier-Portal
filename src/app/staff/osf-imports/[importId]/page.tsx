import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OsfImportReview } from "@/components/staff/osf-import-review";
import { OsfImportStatusBadge } from "@/components/staff/osf-import-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isOsfImportDomainError,
} from "@/lib/osf-imports/errors";
import {
  getOsfImportReview,
  listBrandsForImportResolution,
} from "@/lib/osf-imports/queries";
import { prisma } from "@/lib/db";
import { requireRequirementReadAccess } from "@/lib/requirements/access";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ importId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { importId } = await params;
  return { title: `OSF import ${importId.slice(0, 8)}…` };
}

export default async function OsfImportReviewPage({ params }: PageProps) {
  const { importId } = await params;

  let model;
  let brands;
  let products;
  try {
    model = await getOsfImportReview(importId);
    brands = await listBrandsForImportResolution();
    const user = await requireRequirementReadAccess();
    products = await prisma.product.findMany({
      where: { companyId: user.companyId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, brandId: true },
    });
  } catch (error) {
    if (
      (isOsfImportDomainError(error) && error.code === "NOT_FOUND") ||
      (isAuthorizationError(error) && error.code === "FORBIDDEN")
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Import review
            </h1>
            <OsfImportStatusBadge status={model.status} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Review every Cosmo line on this page — brands stay expanded. Map
            unknowns, edit planned quantities, and exclude lines without opening
            each requirement separately.
          </p>
          <p className="text-sm text-muted-foreground">
            Key {model.idempotencyKey}
            {model.contractVersion ? ` · ${model.contractVersion}` : ""}
            {" · "}
            Received {new Date(model.receivedAt).toLocaleString()}
          </p>
        </div>
        <Link
          href="/staff/osf-imports"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          All imports
        </Link>
      </div>

      <OsfImportReview key={model.importId} model={model} brands={brands} products={products} />
    </div>
  );
}
