import type { Metadata } from "next";
import Link from "next/link";

import { OsfImportStatusBadge } from "@/components/staff/osf-import-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { listOsfImportsForCompany } from "@/lib/osf-imports/queries";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = {
  title: "OSF imports",
  description: "Review Cosmo OSF imports before confirmation.",
};

export default async function OsfImportsListPage() {
  const imports = await listOsfImportsForCompany();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">OSF imports</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Unified review for Cosmo OSF pushes. Open an import to map brands and
          products, edit planned quantities, and exclude lines — all on one page.
        </p>
      </div>

      {imports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No OSF imports yet. Cosmo pushes appear here after ingest.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {imports.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <OsfImportStatusBadge status={row.status} />
                  <span className="text-sm text-muted-foreground">
                    {new Date(row.receivedAt).toLocaleString()}
                  </span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {row.lineCount} lines · {row.requirementCount} brand drafts ·{" "}
                  {row.idempotencyKey}
                </p>
              </div>
              <Link
                href={`/staff/osf-imports/${row.id}`}
                className={cn(buttonVariants({ className: "min-h-11" }))}
              >
                Open review
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/staff"
        className={cn(
          buttonVariants({ variant: "outline", className: "min-h-11 w-fit" }),
        )}
      >
        Back to staff
      </Link>
    </div>
  );
}
