import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import type { AuthState } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

type AuthControlsProps = {
  auth: AuthState;
};

export function AuthControls({ auth }: AuthControlsProps) {
  if (auth.status === "anonymous") {
    return (
      <Link
        href="/auth/login"
        className={cn(buttonVariants({ className: "min-h-11" }))}
      >
        Log in
      </Link>
    );
  }

  const label =
    auth.status === "provisioned"
      ? auth.user.name ?? auth.user.email
      : auth.displayName ?? auth.displayEmail ?? "Signed in";

  const detail =
    auth.status === "provisioned"
      ? `${auth.user.role}${auth.user.supplierId ? " · supplier" : ""}`
      : "Access pending";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <a
        href="/auth/logout"
        className={cn(
          buttonVariants({ variant: "outline", className: "min-h-11" }),
        )}
      >
        Log out
      </a>
    </div>
  );
}
