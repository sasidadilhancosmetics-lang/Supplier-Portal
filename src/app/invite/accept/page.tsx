import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { acceptInviteAction } from "@/app/invite/accept/actions";
import { buttonVariants } from "@/components/ui/button";
import { getAuth0Session } from "@/lib/auth/auth0-session";
import {
  invitationErrorMessage,
  isInvitationError,
} from "@/lib/invitations/errors";
import { buildInviteLoginHref } from "@/lib/invitations/redirects";
import { getInvitationPreview } from "@/lib/invitations/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Link your Auth0 account to a supplier company.",
};

export const instant = false;

type PageProps = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const errorMessage =
    typeof params.error === "string" ? params.error.slice(0, 300) : null;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Invitation required
        </h1>
        <p className="text-muted-foreground">
          This page needs a valid invitation link from your administrator.
        </p>
      </div>
    );
  }

  let preview;
  try {
    preview = await getInvitationPreview(token);
  } catch (error) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Invitation unavailable
        </h1>
        <p className="text-muted-foreground">
          {isInvitationError(error)
            ? invitationErrorMessage(error)
            : "This invitation link is invalid."}
        </p>
      </div>
    );
  }

  const session = await getAuth0Session().catch(() => null);
  const signedIn = Boolean(session?.user?.sub);

  if (preview.status !== "PENDING") {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Invitation {preview.status.toLowerCase()}
        </h1>
        <p className="text-muted-foreground">
          This invitation for {preview.invitedEmail} to join{" "}
          {preview.supplierName} is {preview.status.toLowerCase()}.
        </p>
        <Link href="/" className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}>
          Home
        </Link>
      </div>
    );
  }

  if (!signedIn) {
    redirect(buildInviteLoginHref(token));
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Accept invitation
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          Join <span className="font-medium text-foreground">{preview.supplierName}</span>{" "}
          as a supplier user. You must be signed in with{" "}
          <span className="font-medium text-foreground">{preview.invitedEmail}</span>{" "}
          and a verified Auth0 email.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      ) : null}

      <form action={acceptInviteAction} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className={cn(buttonVariants({ className: "min-h-11 w-fit" }))}
        >
          Link Auth0 account and continue
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        Expires{" "}
        {new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(preview.expiresAt)}
        .
      </p>
    </div>
  );
}
