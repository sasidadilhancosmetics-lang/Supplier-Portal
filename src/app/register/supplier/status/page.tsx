import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { AuthorizationError } from "@/lib/auth/errors";
import { getOwnRegistrationStatus } from "@/lib/suppliers/registration";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Registration status",
  description: "Status of your supplier company registration.",
};

export const instant = false;

export default async function RegistrationStatusPage() {
  let status;
  try {
    status = await getOwnRegistrationStatus();
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "UNAUTHENTICATED") {
      redirect("/auth/login?returnTo=/register/supplier/status");
    }
    throw error;
  }

  if (status.kind === "unlinked") {
    redirect("/register/supplier");
  }

  if (status.kind === "not_supplier") {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Not a supplier registration
        </h1>
        <p className="text-muted-foreground">
          Your account role is {status.role}. This page is for supplier
          applicants only.
        </p>
        <Link href="/" className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}>
          Home
        </Link>
      </div>
    );
  }

  const { supplier } = status;
  const heading =
    supplier.status === "ACTIVE"
      ? "Registration approved"
      : supplier.status === "REJECTED"
        ? "Registration rejected"
        : supplier.status === "PENDING_REVIEW"
          ? "Registration pending"
          : "Supplier inactive";

  const detail =
    supplier.status === "ACTIVE"
      ? "Your supplier company is active. You can open the supplier portal."
      : supplier.status === "REJECTED"
        ? "An admin rejected this registration. Supplier business access remains blocked."
        : supplier.status === "PENDING_REVIEW"
          ? "An admin must activate your company before you can use supplier features."
          : "Your supplier company is inactive. Contact the purchasing company if you need access restored.";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
          <SupplierStatusBadge status={supplier.status} />
        </div>
        <p className="text-base leading-7 text-muted-foreground">{detail}</p>
      </div>

      <div className="rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
        <p>
          Company: <span className="font-medium">{supplier.name}</span>
        </p>
        {supplier.status === "REJECTED" && supplier.rejectionReason ? (
          <p className="mt-2">
            Reason:{" "}
            <span className="font-medium">{supplier.rejectionReason}</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {supplier.status === "ACTIVE" ? (
          <Link
            href="/supplier/profile"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Company profile
          </Link>
        ) : null}
        <Link
          href="/"
          className={cn(
            buttonVariants({
              variant: supplier.status === "ACTIVE" ? "outline" : "default",
              className: "min-h-11",
            }),
          )}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
