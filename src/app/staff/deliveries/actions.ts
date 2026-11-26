"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import { approveDeliverySchedule } from "@/lib/deliveries/approve";
import { isDeliveryDomainError } from "@/lib/deliveries/errors";
import { rejectDelivery, verifyDelivery } from "@/lib/deliveries/verify";

export type VerifyDeliveryActionResult =
  | {
      ok: true;
      deliveryId: string;
      purchaseOrderId: string;
      hasDiscrepancy: boolean;
      grnId: string | null;
    }
  | {
      ok: false;
      message: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

export type RejectDeliveryActionResult =
  | {
      ok: true;
      deliveryId: string;
      purchaseOrderId: string;
    }
  | {
      ok: false;
      message: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

function revalidateDeliveryPaths(deliveryId: string, purchaseOrderId: string) {
  revalidatePath("/staff/deliveries");
  revalidatePath(`/staff/deliveries/${deliveryId}`);
  revalidatePath(`/staff/orders/${purchaseOrderId}`);
  revalidatePath("/staff");
  revalidatePath("/admin");
  revalidatePath(`/supplier/orders/${purchaseOrderId}`);
  revalidatePath("/supplier");
}

export async function approveDeliveryScheduleAction(deliveryId: string) {
  try {
    const result = await approveDeliverySchedule(deliveryId);
    revalidateDeliveryPaths(result.deliveryId, result.purchaseOrderId);
    revalidatePath(`/supplier/orders/${result.purchaseOrderId}/deliver`);
  } catch (error) {
    const message = isDeliveryDomainError(error) ? error.message : "Could not approve the schedule.";
    redirect(`/staff/deliveries/${encodeURIComponent(deliveryId)}?approvalError=${encodeURIComponent(message)}`);
  }
  redirect(`/staff/deliveries/${encodeURIComponent(deliveryId)}`);
}

export async function verifyDeliveryAction(
  _prev: VerifyDeliveryActionResult | undefined,
  formData: FormData,
): Promise<VerifyDeliveryActionResult> {
  try {
    const deliveryItemIds = formData.getAll("deliveryItemId").map(String);
    const quantities = formData.getAll("quantityReceived").map(String);
    const lines = deliveryItemIds.map((deliveryItemId, index) => ({
      deliveryItemId,
      quantityReceived: quantities[index] ?? "",
    }));

    const result = await verifyDelivery({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      deliveryId: String(formData.get("deliveryId") ?? ""),
      receivedAt: String(formData.get("receivedAt") ?? ""),
      discrepancyNotes: String(formData.get("discrepancyNotes") ?? ""),
      lines,
    });

    revalidateDeliveryPaths(result.deliveryId, result.purchaseOrderId);
    return {
      ok: true,
      deliveryId: result.deliveryId,
      purchaseOrderId: result.purchaseOrderId,
      hasDiscrepancy: result.hasDiscrepancy,
      grnId: result.grnId,
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    if (isDeliveryDomainError(error)) {
      return {
        ok: false,
        message: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function rejectDeliveryAction(
  _prev: RejectDeliveryActionResult | undefined,
  formData: FormData,
): Promise<RejectDeliveryActionResult> {
  try {
    const result = await rejectDelivery({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      deliveryId: String(formData.get("deliveryId") ?? ""),
      discrepancyNotes: String(formData.get("discrepancyNotes") ?? ""),
    });
    revalidateDeliveryPaths(result.deliveryId, result.purchaseOrderId);
    return {
      ok: true,
      deliveryId: result.deliveryId,
      purchaseOrderId: result.purchaseOrderId,
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    if (isDeliveryDomainError(error)) {
      return {
        ok: false,
        message: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
