"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isSupplierDomainError,
  supplierErrorMessage,
} from "@/lib/suppliers/errors";
import {
  approveSupplierRegistration,
  rejectSupplierRegistration,
} from "@/lib/suppliers/registration";

export type RegistrationActionResult =
  | { ok: true }
  | { ok: false; error: string };

function toError(error: unknown): RegistrationActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isSupplierDomainError(error)) {
    return { ok: false, error: supplierErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function approveRegistrationAction(
  _prev: RegistrationActionResult | undefined,
  formData: FormData,
): Promise<RegistrationActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    await approveSupplierRegistration(supplierId);
    revalidatePath("/admin/suppliers");
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function rejectRegistrationAction(
  _prev: RegistrationActionResult | undefined,
  formData: FormData,
): Promise<RegistrationActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    const reason = String(formData.get("reason") ?? "");
    await rejectSupplierRegistration({ supplierId, reason });
    revalidatePath("/admin/suppliers");
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
