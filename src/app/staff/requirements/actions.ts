"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isRequirementDomainError,
  requirementErrorMessage,
} from "@/lib/requirements/errors";
import {
  addDraftRequirementItem,
  confirmRequirement,
  createManualDraftRequirement,
  removeDraftRequirementItem,
  updateDraftRequirementItem,
  updateDraftRequirementMeta,
} from "@/lib/requirements/mutations";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(error: unknown): ActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isRequirementDomainError(error)) {
    return { ok: false, error: requirementErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function revalidateRequirement(id: string) {
  revalidatePath("/staff/requirements");
  revalidatePath(`/staff/requirements/${id}`);
}

export async function createRequirementAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const created = await createManualDraftRequirement({
      brandId: String(formData.get("brandId") ?? ""),
      title: String(formData.get("title") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      items: [],
    });
    revalidatePath("/staff/requirements");
    redirect(`/staff/requirements/${created.id}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    return toError(error);
  }
}

export async function updateRequirementMetaAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const requirementId = String(formData.get("requirementId") ?? "");
    await updateDraftRequirementMeta({
      requirementId,
      title: String(formData.get("title") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    revalidateRequirement(requirementId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function addRequirementItemAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const requirementId = String(formData.get("requirementId") ?? "");
    await addDraftRequirementItem({
      requirementId,
      productId: String(formData.get("productId") ?? ""),
      quantityPlanned: String(formData.get("quantityPlanned") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    revalidateRequirement(requirementId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function updateRequirementItemAction(
  formData: FormData,
): Promise<void> {
  const requirementId = String(formData.get("requirementId") ?? "");
  try {
    await updateDraftRequirementItem({
      requirementId,
      itemId: String(formData.get("itemId") ?? ""),
      quantityPlanned: String(formData.get("quantityPlanned") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    revalidateRequirement(requirementId);
  } catch (error) {
    const result = toError(error);
    const message = result.ok ? "Unable to update item." : result.error;
    redirect(
      `/staff/requirements/${encodeURIComponent(requirementId)}?error=${encodeURIComponent(message)}`,
    );
  }
}

export async function removeRequirementItemAction(
  formData: FormData,
): Promise<void> {
  const requirementId = String(formData.get("requirementId") ?? "");
  try {
    await removeDraftRequirementItem({
      requirementId,
      itemId: String(formData.get("itemId") ?? ""),
    });
    revalidateRequirement(requirementId);
  } catch (error) {
    const result = toError(error);
    const message = result.ok ? "Unable to remove item." : result.error;
    redirect(
      `/staff/requirements/${encodeURIComponent(requirementId)}?error=${encodeURIComponent(message)}`,
    );
  }
}

export async function confirmRequirementAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const requirementId = String(formData.get("requirementId") ?? "");
    await confirmRequirement({ requirementId });
    revalidateRequirement(requirementId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
