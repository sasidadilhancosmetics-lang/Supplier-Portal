"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import { createBrandForCompany } from "@/lib/brands/queries";
import {
  isProductDomainError,
  productErrorMessage,
} from "@/lib/products/errors";
import { updateProduct } from "@/lib/products/mutations";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toError(error: unknown): ActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isProductDomainError(error)) {
    return { ok: false, error: productErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true" || value === "1";
}

export async function updateProductAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const productId = String(formData.get("productId") ?? "");
    await updateProduct({
      productId,
      name: String(formData.get("name") ?? ""),
      brandId: String(formData.get("brandId") ?? ""),
      sku: String(formData.get("sku") ?? ""),
      unitOfMeasure: String(formData.get("unitOfMeasure") ?? ""),
      priorityStatus: String(formData.get("priorityStatus") ?? "NORMAL"),
      isActive: formBoolean(formData.get("isActive")),
    });
    revalidatePath("/staff/products");
    revalidatePath(`/staff/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function createBrandAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await createBrandForCompany({
      name: String(formData.get("name") ?? ""),
    });
    revalidatePath("/staff/products");
    revalidatePath("/staff/products/new");
    revalidatePath("/staff/requirements");
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
