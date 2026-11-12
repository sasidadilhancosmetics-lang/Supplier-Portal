"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isSupplierDomainError,
  supplierErrorMessage,
} from "@/lib/suppliers/errors";
import { registerSupplierCompany } from "@/lib/suppliers/registration";

export type RegisterActionResult =
  | { ok: true }
  | { ok: false; error: string };

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export async function registerSupplierAction(
  _prev: RegisterActionResult | undefined,
  formData: FormData,
): Promise<RegisterActionResult> {
  try {
    await registerSupplierCompany({
      name: String(formData.get("name") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
      contactPhone: String(formData.get("contactPhone") ?? ""),
      supportsAllBrands: formBoolean(formData.get("supportsAllBrands")),
      brandIds: formData
        .getAll("brandIds")
        .map((value) => String(value))
        .filter(Boolean),
    });
    revalidatePath("/");
    revalidatePath("/access-pending");
    revalidatePath("/supplier");
    redirect("/register/supplier/status");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    if (isAuthorizationError(error)) {
      return {
        ok: false,
        error:
          error.code === "UNAUTHENTICATED"
            ? "Sign in with Auth0 to register."
            : "You cannot register as a supplier with this account.",
      };
    }
    if (isSupplierDomainError(error)) {
      return { ok: false, error: supplierErrorMessage(error) };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
