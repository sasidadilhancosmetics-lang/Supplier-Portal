import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getPortalArea } from "@/lib/portal-areas";
import { cn } from "@/lib/utils";

const area = getPortalArea("/admin");

export const metadata: Metadata = {
  title: area.title,
  description: area.purpose,
};

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{area.title}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Manage suppliers for the purchasing company, including invitations and
          self-registration review.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Supplier management</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/suppliers"
            className={cn(buttonVariants({ className: "min-h-11" }))}
          >
            View suppliers
          </Link>
          <Link
            href="/admin/suppliers/new"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
          >
            Add supplier
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Products & requirements</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Admins can open the staff area for product master and requirement
          confirmation (permission bypass).
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/staff/products"
            className={cn(
              buttonVariants({ variant: "outline", className: "min-h-11" }),
            )}
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
        </div>
      </section>
    </div>
  );
}
