"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  saveAvailabilityDraft,
  submitAvailability,
} from "@/lib/requests/availability";
import {
  isRequestDomainError,
  requestErrorMessage,
} from "@/lib/requests/errors";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function toError(error: unknown): ActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isRequestDomainError(error)) {
    return {
      ok: false,
      error: requestErrorMessage(error),
      fieldErrors: error.fieldErrors,
    };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function linesFromForm(formData: FormData) {
  const itemIds = formData.getAll("requestItemId").map(String);
  return itemIds.map((requestItemId) => {
    const expectedVersionRaw = String(
      formData.get(`expectedVersion:${requestItemId}`) ?? "",
    ).trim();
    return {
      requestItemId,
      quantityDeclared: String(
        formData.get(`quantityDeclared:${requestItemId}`) ?? "",
      ),
      availableDate: String(
        formData.get(`availableDate:${requestItemId}`) ?? "",
      ),
      notAvailable:
        String(formData.get(`notAvailable:${requestItemId}`) ?? "") === "true",
      notes: String(formData.get(`notes:${requestItemId}`) ?? ""),
      // Omit blank versions so Zod optional does not coerce "" → 0.
      ...(expectedVersionRaw
        ? { expectedVersion: expectedVersionRaw }
        : {}),
    };
  });
}

export async function saveAvailabilityDraftAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const supplierRequestId = String(formData.get("supplierRequestId") ?? "");
    await saveAvailabilityDraft({
      supplierRequestId,
      lines: linesFromForm(formData),
    });
    revalidatePath(`/supplier/requests/${supplierRequestId}`);
    revalidatePath("/supplier/requests");
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function submitAvailabilityAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const supplierRequestId = String(formData.get("supplierRequestId") ?? "");
    await submitAvailability({
      supplierRequestId,
      lines: linesFromForm(formData),
    });
    revalidatePath(`/supplier/requests/${supplierRequestId}`);
    revalidatePath("/supplier/requests");
    revalidatePath("/staff/requests");
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
