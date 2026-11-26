"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

function isNextRedirect(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

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
    const notAvailable = String(formData.get(`notAvailable:${requestItemId}`) ?? "") === "true";
    const quantity = String(formData.get(`quantityDeclared:${requestItemId}`) ?? "");
    const date = String(formData.get(`availableDate:${requestItemId}`) ?? "");
    const extraQuantities = formData.getAll(`splitQuantity:${requestItemId}`).map(String);
    const extraDates = formData.getAll(`splitDate:${requestItemId}`).map(String);
    const hasSplits = !notAvailable && (extraQuantities.length > 0 || extraDates.length > 0);
    return {
      requestItemId,
      ...(!hasSplits ? { quantityDeclared: quantity, availableDate: date } : {
        splits: [{ quantity, date }, ...Array.from({ length: Math.max(extraDates.length, extraQuantities.length) },
          (_, index) => ({ quantity: extraQuantities[index], date: extraDates[index] }))],
      }),
      unitPrice: notAvailable ? "" : String(formData.get(`unitPrice:${requestItemId}`) ?? ""),
      notAvailable,
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
    // Success: leave the form and flash on the list. Errors stay on the form.
    redirect("/supplier/requests?flash=availability-submitted");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return toError(error);
  }
}
