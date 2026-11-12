import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { navAreasForAuth } from "@/lib/auth/nav";
import { getAuthState } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex max-w-2xl flex-col gap-3">
          <Badge variant="secondary">Stage 3A</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Supplier Portal
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
  const areas = navAreasForAuth(auth);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-2xl flex-col gap-3">
        <Badge variant="secondary">Stage 3A</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Supplier Portal
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Auth0 handles sign-in. Your application role and supplier scope come
          from the internal database after an admin links your Auth0 identity.
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

      {auth.status === "provisioned" && auth.user.role === "SUPPLIER" ? (
        <div className="max-w-xl text-sm text-muted-foreground">
          <Link
            href="/register/supplier/status"
            className="underline underline-offset-4"
          >
            View registration status
          </Link>
        </div>
      ) : null}

      {auth.status === "provisioned" && areas.length > 0 ? (
        <section aria-labelledby="areas-heading" className="flex flex-col gap-4">
          <h2 id="areas-heading" className="text-lg font-medium">
            Your area
          </h2>
          <ul className="grid list-none gap-4 sm:grid-cols-2">
            {areas.map((area) => (
              <li key={area.href} className="flex">
                <Card className="h-full w-full">
                  <CardHeader>
                    <h3 className="font-heading text-base leading-snug font-medium">
                      {area.title}
                    </h3>
                    <CardDescription>{area.summary}</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto">
                    <Link
                      href={area.href}
                      className={cn(
                        buttonVariants({
                          variant: "outline",
                          className: "min-h-11",
                        }),
                      )}
                    >
                      Open {area.title}
                    </Link>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="not-included-heading" className="max-w-2xl">
        <h2 id="not-included-heading" className="text-lg font-medium">
          Not included in Stage 3A
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Admin user-provisioning UI</li>
          <li>Supplier requests, orders, deliveries, and other business workflows</li>
        </ul>
      </section>
    </div>
  );
}
