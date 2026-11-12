"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isSupplierDomainError,
  supplierErrorMessage,
} from "@/lib/suppliers/errors";
import { updateOwnSupplierProfile } from "@/lib/suppliers/supplier-self";

export type ProfileActionResult = { ok: true } | { ok: false; error: string };

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export async function updateOwnSupplierProfileAction(
  _prev: ProfileActionResult | undefined,
  formData: FormData,
): Promise<ProfileActionResult> {
  try {
    await updateOwnSupplierProfile({
      name: String(formData.get("name") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
      contactPhone: String(formData.get("contactPhone") ?? ""),
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      city: String(formData.get("city") ?? ""),
      region: String(formData.get("region") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      country: String(formData.get("country") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      supportsAllBrands: formBoolean(formData.get("supportsAllBrands")),
      brandIds: formData
        .getAll("brandIds")
        .map((value) => String(value))
        .filter(Boolean),
    });
    revalidatePath("/supplier/profile");
    return { ok: true };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, error: "You do not have permission to do that." };
    }
    if (isSupplierDomainError(error)) {
      return { ok: false, error: supplierErrorMessage(error) };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
