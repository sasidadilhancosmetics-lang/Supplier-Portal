import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getPortalArea } from "@/lib/portal-areas";
import { cn } from "@/lib/utils";

const area = getPortalArea("/supplier");

export const metadata: Metadata = {
  title: area.title,
  description: area.purpose,
};

export default function SupplierHomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{area.title}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Respond to purchasing requests and keep your company profile up to
          date. Orders and deliveries come in later stages.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/supplier/requests"
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          Requests
        </Link>
        <Link
          href="/supplier/profile"
          className={cn(
            buttonVariants({ variant: "outline", className: "min-h-11" }),
          )}
        >
          Company profile
        </Link>
      </div>
    </div>
  );
}
