import { z } from "zod";
import { availabilityQuantity, quantityUnits } from "@/lib/requests/availability-splits";

const uuidSchema = z
  .string()
  .trim()
  .uuid({ message: "Idempotency key must be a UUID." });

const positiveQty = z
  .string()
  .trim()
  .regex(availabilityQuantity, "Enter up to four decimal places.")
  .refine((value) => (quantityUnits(value) ?? BigInt(0)) > 0, "Quantity must be a positive number.");

export const allocateLineSchema = z.object({
  availabilityOfferId: z.string().trim().min(1),
  quantity: positiveQty,
  splitDate: z.iso.date().optional(),
});

export const allocateInputSchema = z.object({
  idempotencyKey: uuidSchema,
  supplierId: z.string().trim().min(1),
  lines: z.array(allocateLineSchema).min(1, "Add at least one line."),
  abovePlan: z
    .object({
      acknowledged: z.literal(true),
      reason: z.string().trim().min(1, "Above-plan reason is required."),
    })
    .optional(),
});

export const previewAllocationSchema = z.object({
  supplierId: z.string().trim().min(1),
  lines: z.array(allocateLineSchema).min(1),
});

export const confirmOrderInputSchema = z.object({
  idempotencyKey: uuidSchema,
  purchaseOrderId: z.string().trim().min(1),
});

export const cancelOrderInputSchema = z.object({
  idempotencyKey: uuidSchema,
  purchaseOrderId: z.string().trim().min(1),
  cancelReason: z
    .string()
    .trim()
    .min(1, "Cancellation reason is required.")
    .max(500, "Cancellation reason must be at most 500 characters."),
});

export const supplierOrderListQuerySchema = z.object({
  status: z
    .enum(["SENT", "CONFIRMED", "CANCELLED", "DRAFT", "PARTIALLY_DELIVERED", "PARTIALLY_CANCELLED", "DELIVERED"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const staffOrderListQuerySchema = z.object({
  status: z
    .enum([
      "SENT",
      "CONFIRMED",
      "CANCELLED",
      "DRAFT",
      "PARTIALLY_DELIVERED",
      "PARTIALLY_CANCELLED",
      "DELIVERED",
      "AWAITING_CONFIRMATION",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AllocateInput = z.infer<typeof allocateInputSchema>;
export type PreviewAllocationInput = z.infer<typeof previewAllocationSchema>;
export type ConfirmOrderInput = z.infer<typeof confirmOrderInputSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderInputSchema>;

/** Stable payload for idempotency hashing (sorted line ids). */
export function canonicalAllocatePayload(input: {
  supplierId: string;
  lines: { availabilityOfferId: string; quantity: string; splitDate?: string }[];
  abovePlan?: { acknowledged: true; reason: string };
}) {
  const lines = [...input.lines]
    .map((l) => ({
      availabilityOfferId: l.availabilityOfferId,
      quantity: l.quantity,
      ...(l.splitDate ? { splitDate: l.splitDate } : {}),
    }))
    .sort((a, b) =>
      a.availabilityOfferId.localeCompare(b.availabilityOfferId) ||
      (a.splitDate ?? "").localeCompare(b.splitDate ?? ""),
    );
  return {
    supplierId: input.supplierId,
    lines,
    abovePlan: input.abovePlan
      ? {
          acknowledged: true as const,
          reason: input.abovePlan.reason,
        }
      : undefined,
  };
}

export function canonicalConfirmPayload(input: { purchaseOrderId: string }) {
  return { purchaseOrderId: input.purchaseOrderId };
}

export function canonicalCancelPayload(input: {
  purchaseOrderId: string;
  cancelReason: string;
}) {
  return {
    purchaseOrderId: input.purchaseOrderId,
    cancelReason: input.cancelReason.trim(),
  };
}
