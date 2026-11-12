"use server";

import { redirect } from "next/navigation";

import { AuthorizationError, isAuthorizationError } from "@/lib/auth/errors";
import {
  invitationErrorMessage,
  isInvitationError,
} from "@/lib/invitations/errors";
import { buildInviteLoginHref } from "@/lib/invitations/redirects";
import { acceptSupplierInvitation } from "@/lib/invitations/service";

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");

  try {
    await acceptSupplierInvitation(token);
    redirect("/supplier/profile");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }

    if (isAuthorizationError(error) && error.code === "UNAUTHENTICATED") {
      redirect(buildInviteLoginHref(token));
    }

    const message = isInvitationError(error)
      ? invitationErrorMessage(error)
      : error instanceof AuthorizationError
        ? "You must sign in to accept this invitation."
        : "Unable to accept this invitation.";

    redirect(
      `/invite/accept?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`,
    );
  }
}
