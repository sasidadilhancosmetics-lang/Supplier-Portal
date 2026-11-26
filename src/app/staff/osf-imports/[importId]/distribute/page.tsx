import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OsfImportDistributeWizard } from "@/components/staff/osf-import-distribute-wizard";
import { OsfImportStatusBadge } from "@/components/staff/osf-import-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { getOsfImportDistributeModel } from "@/lib/osf-imports/distribute";
import {
  isOsfImportDomainError,
} from "@/lib/osf-imports/errors";
import { cn } from "@/lib/utils";

export const instant = false;

type PageProps = {
  params: Promise<{ importId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { importId } = await params;
  return { title: `Distribute OSF import ${importId.slice(0, 8)}…` };
}

export default async function OsfImportDistributePage({ params }: PageProps) {
  const { importId } = await params;

  let model;
  try {
    model = await getOsfImportDistributeModel(importId);
  } catch (error) {
    if (isOsfImportDomainError(error) && error.code === "NOT_FOUND") {
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
              Send availability requests
            </h1>
            <OsfImportStatusBadge status={model.status} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            Review confirmed brand requirements, choose matching suppliers, and
            send availability requests in one step. Purchase orders are not
            created here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/staff/osf-imports/${importId}`}
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Import review
          </Link>
          <Link
            href="/staff/osf-imports"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            All imports
          </Link>
        </div>
      </div>

      {model.brands.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          This import has no confirmed brand requirements to distribute.
        </p>
      ) : (
        <OsfImportDistributeWizard
          importId={model.importId}
          brands={model.brands}
          confirmedAt={model.confirmedAt}
        />
      )}
    </div>
  );
}
