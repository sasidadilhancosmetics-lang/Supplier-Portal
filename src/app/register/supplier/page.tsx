import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { registerSupplierAction } from "@/app/register/supplier/actions";
import { SupplierRegistrationForm } from "@/components/supplier/registration-form";
import { buttonVariants } from "@/components/ui/button";
import { getAuth0Session } from "@/lib/auth/auth0-session";
import { getAuthState } from "@/lib/auth/session";
import { listBrandsForRegistration } from "@/lib/suppliers/registration";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Register as supplier",
  description: "Register your supplier company for admin review.",
};

export const instant = false;

export default async function RegisterSupplierPage() {
  const auth = await getAuthState();

  if (auth.status === "anonymous") {
    redirect("/auth/login?returnTo=/register/supplier");
  }

  if (auth.status === "provisioned") {
    if (auth.user.role === "SUPPLIER") {
      redirect("/register/supplier/status");
    }
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Already provisioned
        </h1>
        <p className="text-muted-foreground">
          This Auth0 account is already linked as {auth.user.role}. Self-registration
          is only for new supplier companies.
        </p>
        <Link href="/" className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}>
          Home
        </Link>
      </div>
    );
  }

  const session = await getAuth0Session().catch(() => null);
  const emailVerified = session?.user?.email_verified === true;
  const email =
    typeof session?.user?.email === "string" ? session.user.email : null;
  const displayName =
    typeof session?.user?.name === "string" ? session.user.name : null;

  if (!emailVerified) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Verify your email
        </h1>
        <p className="text-muted-foreground">
          Confirm your Auth0 email before registering a supplier company.
          {email ? ` Signed in as ${email}.` : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/access-pending"
            className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}
          >
            Access status
          </Link>
          <a
            href="/auth/logout"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Log out
          </a>
        </div>
      </div>
    );
  }

  let brands: { id: string; name: string }[] = [];
  try {
    brands = await listBrandsForRegistration();
  } catch {
    brands = [];
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Register as supplier
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Submit your company details for admin review. You will not access
          supplier business data until an admin activates your company.
        </p>
        <p className="text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">{email}</span>
          .
        </p>
      </div>

      <SupplierRegistrationForm
        action={registerSupplierAction}
        brands={brands}
        defaultContactEmail={email}
        defaultContactName={displayName}
      />
    </div>
  );
}
