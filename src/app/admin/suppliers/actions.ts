"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  changeSupplierStatus,
  createSupplier,
  updateSupplierExternalId,
  updateSupplierProfile,
} from "@/lib/suppliers/mutations";
import {
  isSupplierDomainError,
  supplierErrorMessage,
} from "@/lib/suppliers/errors";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

function toActionError(error: unknown): ActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: false, error: supplierErrorMessage(error) };
}

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

function formBrandIds(formData: FormData): string[] {
  return formData
    .getAll("brandIds")
    .map((value) => String(value))
    .filter((value) => value.length > 0);
}

function profileFromForm(formData: FormData) {
  return {
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
    brandIds: formBrandIds(formData),
  };
}

export async function createSupplierAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const created = await createSupplier(profileFromForm(formData));
    revalidatePath("/admin/suppliers");
    redirect(`/admin/suppliers/${created.id}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    return toActionError(error);
  }
}

export async function updateSupplierAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    await updateSupplierProfile({
      supplierId,
      ...profileFromForm(formData),
    });
    revalidatePath("/admin/suppliers");
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function changeSupplierStatusAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    const status = String(formData.get("status") ?? "");
    await changeSupplierStatus({ supplierId, status });
    revalidatePath("/admin/suppliers");
    revalidatePath(`/admin/suppliers/${supplierId}`);
    return { ok: true };
  } catch (error) {
    if (isSupplierDomainError(error) || isAuthorizationError(error)) {
      return toActionError(error);
    }
    return toActionError(error);
  }
}

export async function updateSupplierExternalIdAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const supplierId = String(formData.get("supplierId") ?? "");
    const expectedRaw = formData.get("expectedExternalId");
    const expectedExternalId =
      expectedRaw == null || String(expectedRaw) === ""
        ? null
        : String(expectedRaw);
    await updateSupplierExternalId({
      supplierId,
      externalId: String(formData.get("externalId") ?? ""),
      confirmChange:
        formData.get("confirmChange") === "true" ||
        formData.get("confirmChange") === "on" ||
        formData.get("confirmChange") === "1",
      expectedExternalId,
    });
    revalidatePath("/admin/suppliers");
    revalidatePath(`/admin/suppliers/${supplierId}`);
    revalidatePath("/staff/osf-imports");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
