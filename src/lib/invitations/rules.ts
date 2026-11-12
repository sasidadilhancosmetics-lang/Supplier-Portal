import type { InvitationStatus } from "@/generated/prisma/client";

import { normalizeEmail } from "./crypto";

export function invitationEffectiveStatus(args: {
  status: InvitationStatus;
  expiresAt: Date;
  now?: Date;
}): InvitationStatus | "EXPIRED" {
  if (args.status === "PENDING" && args.expiresAt.getTime() <= (args.now ?? new Date()).getTime()) {
    return "EXPIRED";
  }
  return args.status;
}

export function emailsMatchForInvite(
  invitedEmail: string,
  authEmail: string | null | undefined,
): boolean {
  if (!authEmail) {
    return false;
  }
  return normalizeEmail(invitedEmail) === normalizeEmail(authEmail);
}
