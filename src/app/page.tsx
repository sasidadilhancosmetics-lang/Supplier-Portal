import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { homeDashboardHref } from "@/lib/auth/nav";
import { getAuthState } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="max-w-md">
            <span className="sr-only">Supplier Portal</span>
            <BrandLogo variant="full" size="lg" decorative />
          </h1>
          <p className="text-base leading-7 text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const auth = await getAuthState();
  const dashboard = homeDashboardHref(auth);
  if (dashboard) {
    redirect(dashboard);
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="max-w-md">
          <span className="sr-only">Supplier Portal</span>
          <BrandLogo variant="full" size="lg" priority animated decorative />
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Sign in to manage suppliers, OSF requirements, availability requests,
          and purchase orders for your company.
        </p>
      </div>

      {auth.status === "anonymous" ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/auth/login"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Log in
          </Link>
          <Link
            href="/register/supplier"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Register as supplier
          </Link>
        </div>
      ) : null}

      {auth.status === "pending" ? (
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
          <p>
            You are signed in, but access is pending.{" "}
            <Link
              href="/access-pending"
              className="underline underline-offset-4"
            >
              View access status
            </Link>
            .
          </p>
          <Link
            href="/register/supplier"
            className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
          >
            Register as supplier
          </Link>
        </div>
      ) : null}
    </div>
  );
}
