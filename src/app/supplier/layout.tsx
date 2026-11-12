import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { requireSupplierIdentityPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

export const instant = false;

export default async function SupplierLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireSupplierIdentityPage();

  const supplier = await prisma.supplier.findFirst({
    where: { id: user.supplierId!, companyId: user.companyId },
    select: {
      id: true,
      name: true,
      status: true,
      rejectionReason: true,
      registrationSource: true,
    },
  });

  if (!supplier) {
    redirect("/");
  }

  if (supplier.status !== "ACTIVE") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {supplier.name}
            </h1>
            <SupplierStatusBadge status={supplier.status} />
          </div>
          <p className="text-base leading-7 text-muted-foreground">
            {supplier.status === "PENDING_REVIEW"
              ? "Your registration is waiting for admin activation. Supplier business data stays locked until then."
              : supplier.status === "REJECTED"
                ? "This registration was rejected. Supplier business access remains blocked."
                : "This supplier company is inactive. Supplier business access is blocked."}
          </p>
        </div>
        {supplier.status === "REJECTED" && supplier.rejectionReason ? (
          <div className="rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
            Reason: {supplier.rejectionReason}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/register/supplier/status"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Registration status
          </Link>
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Home
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
