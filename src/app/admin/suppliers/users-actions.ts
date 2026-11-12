"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  invitationErrorMessage,
  isInvitationError,
} from "@/lib/invitations/errors";
import {
  createSupplierInvitation,
  revokeSupplierInvitation,
  setSupplierUserActive,
} from "@/lib/invitations/service";

export type InviteActionResult =
  | { ok: true; acceptUrl?: string; expiresAt?: string }
  | { ok: false; error: string };

export type UserActionResult = { ok: true } | { ok: false; error: string };

function toError(error: unknown): { ok: false; error: string } {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isInvitationError(error)) {
    return { ok: false, error: invitationErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function inviteSupplierUserAction(
  _prev: InviteActionResult | undefined,
  formData: FormData,
): Promise<InviteActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    const email = String(formData.get("email") ?? "");
    const created = await createSupplierInvitation({ supplierId, email });
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return {
      ok: true,
      acceptUrl: created.acceptUrl,
      expiresAt: created.expiresAt.toISOString(),
    };
  } catch (error) {
    return toError(error);
  }
}

export async function revokeInvitationAction(
  _prev: UserActionResult | undefined,
  formData: FormData,
): Promise<UserActionResult> {
  try {
    const invitationId = String(formData.get("invitationId") ?? "");
    const supplierId = String(formData.get("supplierId") ?? "");
    await revokeSupplierInvitation(invitationId);
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function setSupplierUserActiveAction(
  _prev: UserActionResult | undefined,
  formData: FormData,
): Promise<UserActionResult> {
  try {
    const userId = String(formData.get("userId") ?? "");
    const supplierId = String(formData.get("supplierId") ?? "");
    const isActive = String(formData.get("isActive") ?? "") === "true";
    await setSupplierUserActive({ userId, supplierId, isActive });
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
