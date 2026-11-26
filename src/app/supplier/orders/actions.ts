"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import { cancelPurchaseOrder } from "@/lib/orders/cancel";
import { confirmPurchaseOrder } from "@/lib/orders/confirm";
import { isOrderDomainError } from "@/lib/orders/errors";

export type ConfirmOrderActionResult =
  | {
      ok: true;
      purchaseOrderId: string;
      orderNumber: string;
      confirmedAt: string;
    }
  | { ok: false; message: string; code?: string };

export type CancelOrderActionResult =
  | {
      ok: true;
      purchaseOrderId: string;
      orderNumber: string;
      cancelledAt: string;
      status: string;
    }
  | { ok: false; message: string; code?: string; fieldErrors?: Record<string, string> };

function revalidateOrderPaths(purchaseOrderId: string) {
  revalidatePath("/supplier/orders");
  revalidatePath(`/supplier/orders/${purchaseOrderId}`);
  revalidatePath(`/staff/orders/${purchaseOrderId}`);
  revalidatePath("/staff/orders");
}

export async function confirmPurchaseOrderAction(
  _prev: ConfirmOrderActionResult | undefined,
  formData: FormData,
): Promise<ConfirmOrderActionResult> {
  try {
    const result = await confirmPurchaseOrder({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      purchaseOrderId: String(formData.get("purchaseOrderId") ?? ""),
    });
    revalidateOrderPaths(result.purchaseOrderId);
    return {
      ok: true,
      purchaseOrderId: result.purchaseOrderId,
      orderNumber: result.orderNumber,
      confirmedAt: result.confirmedAt,
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    if (isOrderDomainError(error)) {
      return { ok: false, message: error.message, code: error.code };
    }
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function cancelPurchaseOrderAction(
  _prev: CancelOrderActionResult | undefined,
  formData: FormData,
): Promise<CancelOrderActionResult> {
  try {
    const result = await cancelPurchaseOrder({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      purchaseOrderId: String(formData.get("purchaseOrderId") ?? ""),
      cancelReason: String(formData.get("cancelReason") ?? ""),
    });
    revalidateOrderPaths(result.purchaseOrderId);
    return {
      ok: true,
      purchaseOrderId: result.purchaseOrderId,
      orderNumber: result.orderNumber,
      cancelledAt: result.cancelledAt,
      status: result.status,
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    if (isOrderDomainError(error)) {
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
