"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isPricingDomainError,
  pricingErrorMessage,
} from "@/lib/pricing/errors";
import {
  supplierAcceptCounter,
  supplierReviseOffer,
} from "@/lib/pricing/quotes";

export type SupplierPriceActionResult =
  | { ok: true }
  | { ok: false; error: string };

function toError(error: unknown): SupplierPriceActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isPricingDomainError(error)) {
    return { ok: false, error: pricingErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function supplierAcceptCounterAction(
  _prev: SupplierPriceActionResult | undefined,
  formData: FormData,
): Promise<SupplierPriceActionResult> {
  let result: Awaited<ReturnType<typeof supplierAcceptCounter>>;
  try {
    result = await supplierAcceptCounter({
      availabilityOfferId: String(formData.get("availabilityOfferId") ?? ""),
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
    });
  } catch (error) {
    return toError(error);
  }

  const requestId =
    String(formData.get("supplierRequestId") ?? "") ||
    result.supplierRequestId;

  revalidatePath(`/supplier/requests/${requestId}`);
  revalidatePath("/supplier/requests");
  revalidatePath("/supplier");
  revalidatePath(`/staff/offers/${result.availabilityOfferId}/negotiate`);
  revalidatePath("/staff/requests");

  const params = new URLSearchParams({
    flash: "price-accepted",
    price: result.unitPrice,
    currency: result.currencyCode,
  });
  redirect(`/supplier/requests/${requestId}?${params.toString()}`);
}

export async function supplierReviseOfferAction(
  _prev: SupplierPriceActionResult | undefined,
  formData: FormData,
): Promise<SupplierPriceActionResult> {
  try {
    const result = await supplierReviseOffer({
      availabilityOfferId: String(formData.get("availabilityOfferId") ?? ""),
      unitPrice: String(formData.get("unitPrice") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
    });
    const requestId = String(formData.get("supplierRequestId") ?? "");
    revalidatePath(`/supplier/requests/${requestId}`);
    revalidatePath("/supplier/requests");
    revalidatePath(`/staff/offers/${result.availabilityOfferId}/negotiate`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
