"use server";

import { revalidatePath } from "next/cache";

import { isAuthorizationError } from "@/lib/auth/errors";
import { isDeliveryDomainError } from "@/lib/deliveries/errors";
import { rescheduleDelivery } from "@/lib/deliveries/reschedule";
import { scheduleDelivery } from "@/lib/deliveries/schedule";

export type ScheduleDeliveryActionResult =
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

export type RescheduleDeliveryActionResult = ScheduleDeliveryActionResult;

function parseConfirmed(formData: FormData) {
  const confirmedRaw = formData.get("confirmed");
  return confirmedRaw === "on" ||
    confirmedRaw === "true" ||
    confirmedRaw === "1"
    ? true
    : confirmedRaw;
}

function parseLines(formData: FormData) {
  const orderItemIds = formData.getAll("orderItemId").map(String);
  const hasKeyedQuantities = orderItemIds.some((id) => formData.has(`quantity:${id}`));
  const quantities = formData.getAll("quantity").map(String);
  return orderItemIds
    .map((orderItemId, index) => ({
      orderItemId,
      quantity: hasKeyedQuantities
        ? String(formData.get(`quantity:${orderItemId}`) ?? "")
        : quantities[index] ?? "",
    }))
    .filter((line) => line.quantity.trim() !== "");
}

function revalidateSchedulePaths(purchaseOrderId: string) {
  revalidatePath("/supplier");
  revalidatePath("/supplier/orders");
  revalidatePath(`/supplier/orders/${purchaseOrderId}`);
  revalidatePath(`/supplier/orders/${purchaseOrderId}/deliver`);
  revalidatePath("/supplier/deliveries");
  revalidatePath("/staff/deliveries");
  revalidatePath("/staff");
  revalidatePath("/admin");
}

export async function scheduleDeliveryAction(
  _prev: ScheduleDeliveryActionResult | undefined,
  formData: FormData,
): Promise<ScheduleDeliveryActionResult> {
  try {
    const result = await scheduleDelivery({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      purchaseOrderId: String(formData.get("purchaseOrderId") ?? ""),
      plannedDeliveryAt: String(formData.get("plannedDeliveryAt") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      confirmed: parseConfirmed(formData),
      lines: parseLines(formData),
    });

    revalidateSchedulePaths(result.purchaseOrderId);
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

export async function rescheduleDeliveryAction(
  _prev: RescheduleDeliveryActionResult | undefined,
  formData: FormData,
): Promise<RescheduleDeliveryActionResult> {
  try {
    const result = await rescheduleDelivery({
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      deliveryId: String(formData.get("deliveryId") ?? ""),
      plannedDeliveryAt: String(formData.get("plannedDeliveryAt") ?? ""),
      rescheduleReason: String(formData.get("rescheduleReason") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      confirmed: parseConfirmed(formData),
      lines: parseLines(formData),
    });

    revalidateSchedulePaths(result.purchaseOrderId);
    revalidatePath(
      `/supplier/orders/${result.purchaseOrderId}/deliveries/${result.supersededDeliveryId}`,
    );
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
