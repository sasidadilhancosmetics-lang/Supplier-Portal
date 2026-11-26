"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isPricingDomainError,
  pricingErrorMessage,
} from "@/lib/pricing/errors";
import {
  staffAttestAgreedPrice,
  staffCounterOffer,
  staffRecordExternalNegotiation,
} from "@/lib/pricing/quotes";

export type PricingActionResult =
  | { ok: true }
  | { ok: false; error: string };

function toError(error: unknown): PricingActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isPricingDomainError(error)) {
    return { ok: false, error: pricingErrorMessage(error) };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function revalidateOfferPaths(offerId: string, productId?: string) {
  revalidatePath(`/staff/offers/${offerId}/negotiate`);
  revalidatePath("/staff/requests");
  revalidatePath("/staff/orders/allocate");
  if (productId) {
    revalidatePath(`/staff/products/${productId}/prices`);
  }
}

export async function staffCounterOfferAction(
  _prev: PricingActionResult | undefined,
  formData: FormData,
): Promise<PricingActionResult> {
  try {
    const result = await staffCounterOffer({
      availabilityOfferId: String(formData.get("availabilityOfferId") ?? ""),
      unitPrice: String(formData.get("unitPrice") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
    });
    revalidateOfferPaths(
      result.availabilityOfferId,
      String(formData.get("productId") || "") || undefined,
    );
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function staffRecordExternalAction(
  _prev: PricingActionResult | undefined,
  formData: FormData,
): Promise<PricingActionResult> {
  try {
    const result = await staffRecordExternalNegotiation({
      availabilityOfferId: String(formData.get("availabilityOfferId") ?? ""),
      unitPrice: String(formData.get("unitPrice") ?? ""),
      channel: String(formData.get("channel") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      negotiationOccurredAt: String(
        formData.get("negotiationOccurredAt") ?? "",
      ),
      expectedVersion: String(formData.get("expectedVersion") ?? "1"),
    });
    revalidateOfferPaths(
      result.availabilityOfferId,
      String(formData.get("productId") || "") || undefined,
    );
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function staffAttestAction(
  _prev: PricingActionResult | undefined,
  formData: FormData,
): Promise<PricingActionResult> {
  try {
    const result = await staffAttestAgreedPrice({
      availabilityOfferId: String(formData.get("availabilityOfferId") ?? ""),
      attestationStatement: String(
        formData.get("attestationStatement") ?? "",
      ),
      evidenceNote: String(formData.get("evidenceNote") ?? ""),
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
    });
    revalidateOfferPaths(
      result.availabilityOfferId,
      String(formData.get("productId") || "") || undefined,
    );
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
