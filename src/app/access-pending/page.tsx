import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { getAuthState } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Access pending",
  description: "Your Auth0 login is not linked to a provisioned portal user yet.",
};

export default function AccessPendingPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-xl text-sm text-muted-foreground">
          Checking access…
        </div>
      }
    >
      <AccessPendingContent />
    </Suspense>
  );
}

async function AccessPendingContent() {
  const auth = await getAuthState();

  if (auth.status === "anonymous") {
    redirect("/auth/login");
  }

  if (auth.status === "provisioned") {
    redirect("/");
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Access pending</h1>
        <p className="text-base leading-7 text-muted-foreground">
          You signed in successfully, but this Auth0 identity is not linked to an
          internal portal user yet. An authorized admin must provision your account
          before you can open Admin, Staff, or Supplier areas.
        </p>
      </div>
      <div className="rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
        <p>
          Signed in as{" "}
          <span className="font-medium">
            {auth.displayName ?? auth.displayEmail ?? "unknown"}
          </span>
          {auth.displayEmail && auth.displayName
            ? ` (${auth.displayEmail})`
            : null}
          .
        </p>
        <p className="mt-2 text-muted-foreground">
          Matching email alone never grants access. Your Auth0 subject must be
          linked to an existing internal User via ExternalIdentity.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/register/supplier"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Register as supplier
        </Link>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}
        >
          Home
        </Link>
        <a
          href="/auth/logout"
          className={cn(buttonVariants({ variant: "outline", className: "min-h-11" }))}
        >
          Log out
        </a>
      </div>
      <p className="text-sm text-muted-foreground">
        Already invited to an existing supplier company? Use your invitation
        link instead of registering a new company.
      </p>
    </div>
  );
}
