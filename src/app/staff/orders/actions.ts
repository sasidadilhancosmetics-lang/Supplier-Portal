"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  allocatePurchaseOrder,
  previewAllocation,
} from "@/lib/orders/allocate";
import { isOrderDomainError } from "@/lib/orders/errors";

export type AllocateActionResult =
  | { ok: true; purchaseOrderId: string; orderNumber: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string>;
      code?: string;
    };

function readLines(formData: FormData) {
  const offerIds = formData.getAll("availabilityOfferId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const dates = formData.getAll("splitDate").map(String);
  const keys = formData.getAll("allocationRowKey").map(String);
  const lines = offerIds.map((availabilityOfferId, index) => ({
    availabilityOfferId,
    quantity: keys[index] ? String(formData.get("quantity:" + keys[index]) ?? "") : quantities[index] ?? "",
    splitDate: dates[index] || undefined,
  }));
  return lines.filter((l) => l.quantity.trim() !== "" && !/^0+(?:\.0+)?$/.test(l.quantity.trim()));
}

export async function allocatePurchaseOrderAction(
  _prev: AllocateActionResult | undefined,
  formData: FormData,
): Promise<AllocateActionResult> {
  const acknowledged = formData.get("abovePlanAcknowledged") === "on";
  const reason = String(formData.get("abovePlanReason") ?? "").trim();
  const input = {
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    lines: readLines(formData),
    abovePlan:
      acknowledged && reason
        ? ({ acknowledged: true as const, reason })
        : undefined,
  };

  try {
    const result = await allocatePurchaseOrder(input);
    revalidatePath("/staff/requests");
    revalidatePath("/staff/orders");
    redirect(`/staff/orders/${result.purchaseOrderId}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    if (isOrderDomainError(error)) {
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors,
        code: error.code,
      };
    }
    throw error;
  }
}

export async function previewAllocationAction(input: {
  supplierId: string;
  lines: { availabilityOfferId: string; quantity: string; splitDate?: string }[];
}) {
  try {
    return { ok: true as const, preview: await previewAllocation(input) };
  } catch (error) {
    if (isOrderDomainError(error)) {
      return {
        ok: false as const,
        message: error.message,
        fieldErrors: error.fieldErrors,
      };
    }
    throw error;
  }
}
