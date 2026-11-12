import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getPortalArea } from "@/lib/portal-areas";
import { cn } from "@/lib/utils";

const area = getPortalArea("/staff");

export const metadata: Metadata = {
  title: area.title,
  description: area.purpose,
};

export default function StaffHomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{area.title}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Product master, requirements, and supplier request distribution for
          the purchasing company.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Workflows</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/staff/products"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            Products
          </Link>
          <Link
            href="/staff/requirements"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Requirements
          </Link>
          <Link
            href="/staff/requests"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Supplier requests
          </Link>
        </div>
      </section>
    </div>
  );
}
