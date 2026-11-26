import { z } from "zod";

import {
  DELIVERY_NOTES_MAX_LENGTH,
  RESCHEDULE_REASON_MAX_LENGTH,
} from "./constants";

const uuidSchema = z
  .string()
  .trim()
  .uuid({ message: "Idempotency key must be a UUID." });

const positiveQty = z
  .string()
  .trim()
  .refine((v) => {
    if (!v) return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  }, "Quantity must be a positive number.")
  .transform((v) => v);

const nonNegativeQty = z
  .string()
  .trim()
  .refine((v) => {
    if (!v) return false;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
  }, "Enter the actual received quantity (0 or more).")
  .transform((v) => v);

const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid delivery date.");

export const submitDeliveryLineSchema = z.object({
  orderItemId: z.string().trim().min(1),
  quantity: positiveQty,
});

export const submitDeliveryInputSchema = z.object({
  idempotencyKey: uuidSchema,
  purchaseOrderId: z.string().trim().min(1),
  deliveredAt: calendarDateSchema,
  notes: z
    .string()
    .trim()
    .max(DELIVERY_NOTES_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
  confirmed: z.literal(true),
  lines: z
    .array(submitDeliveryLineSchema)
    .min(1, "Add at least one delivery quantity."),
});

export const verifyDeliveryLineSchema = z.object({
  deliveryItemId: z.string().trim().min(1),
  quantityReceived: nonNegativeQty,
});

export const scheduleDeliveryLineSchema = z.object({
  orderItemId: z.string().trim().min(1),
  quantity: positiveQty,
});

export const scheduleDeliveryInputSchema = z.object({
  idempotencyKey: uuidSchema,
  purchaseOrderId: z.string().trim().min(1),
  plannedDeliveryAt: calendarDateSchema,
  notes: z
    .string()
    .trim()
    .max(DELIVERY_NOTES_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
  confirmed: z.literal(true),
  lines: z
    .array(scheduleDeliveryLineSchema)
    .min(1, "Add at least one planned quantity."),
});

export const rescheduleDeliveryInputSchema = z.object({
  idempotencyKey: uuidSchema,
  deliveryId: z.string().trim().min(1),
  plannedDeliveryAt: calendarDateSchema,
  rescheduleReason: z
    .string()
    .trim()
    .min(1, "Reschedule reason is required.")
    .max(RESCHEDULE_REASON_MAX_LENGTH),
  notes: z
    .string()
    .trim()
    .max(DELIVERY_NOTES_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
  confirmed: z.literal(true),
  lines: z
    .array(scheduleDeliveryLineSchema)
    .min(1, "Add at least one planned quantity."),
});

export const verifyDeliveryInputSchema = z.object({
  idempotencyKey: uuidSchema,
  deliveryId: z.string().trim().min(1),
  /** Actual receipt date (today/past Asia/Colombo). Required for SCHEDULED; optional for legacy SUBMITTED. */
  receivedAt: calendarDateSchema.optional().or(z.literal("")),
  lines: z.array(verifyDeliveryLineSchema).min(1),
  discrepancyNotes: z
    .string()
    .trim()
    .max(DELIVERY_NOTES_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
});

export const rejectDeliveryInputSchema = z.object({
  idempotencyKey: uuidSchema,
  deliveryId: z.string().trim().min(1),
  discrepancyNotes: z
    .string()
    .trim()
    .min(1, "Discrepancy notes are required when flagging a delivery.")
    .max(DELIVERY_NOTES_MAX_LENGTH),
});

export function canonicalSubmitDeliveryPayload(input: {
  purchaseOrderId: string;
  deliveredAt: string;
  notes?: string | null;
  lines: Array<{ orderItemId: string; quantity: string }>;
}) {
  return {
    purchaseOrderId: input.purchaseOrderId,
    deliveredAt: input.deliveredAt,
    notes: input.notes?.trim() || null,
    lines: [...input.lines]
      .map((l) => ({
        orderItemId: l.orderItemId,
        quantity: l.quantity,
      }))
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  };
}

export function canonicalScheduleDeliveryPayload(input: {
  purchaseOrderId: string;
  plannedDeliveryAt: string;
  notes?: string | null;
  lines: Array<{ orderItemId: string; quantity: string }>;
}) {
  return {
    purchaseOrderId: input.purchaseOrderId,
    plannedDeliveryAt: input.plannedDeliveryAt,
    notes: input.notes?.trim() || null,
    lines: [...input.lines]
      .map((l) => ({
        orderItemId: l.orderItemId,
        quantity: l.quantity,
      }))
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  };
}

export function canonicalRescheduleDeliveryPayload(input: {
  deliveryId: string;
  plannedDeliveryAt: string;
  rescheduleReason: string;
  notes?: string | null;
  lines: Array<{ orderItemId: string; quantity: string }>;
}) {
  return {
    deliveryId: input.deliveryId,
    plannedDeliveryAt: input.plannedDeliveryAt,
    rescheduleReason: input.rescheduleReason.trim(),
    notes: input.notes?.trim() || null,
    lines: [...input.lines]
      .map((l) => ({
        orderItemId: l.orderItemId,
        quantity: l.quantity,
      }))
      .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  };
}

export function canonicalVerifyDeliveryPayload(input: {
  deliveryId: string;
  receivedAt?: string | null;
  lines: Array<{ deliveryItemId: string; quantityReceived: string }>;
  discrepancyNotes?: string | null;
}) {
  return {
    deliveryId: input.deliveryId,
    receivedAt: input.receivedAt?.trim() || null,
    discrepancyNotes: input.discrepancyNotes?.trim() || null,
    lines: [...input.lines]
      .map((l) => ({
        deliveryItemId: l.deliveryItemId,
        quantityReceived: l.quantityReceived,
      }))
      .sort((a, b) => a.deliveryItemId.localeCompare(b.deliveryItemId)),
  };
}

export function canonicalRejectDeliveryPayload(input: {
  deliveryId: string;
  discrepancyNotes: string;
}) {
  return {
    deliveryId: input.deliveryId,
    discrepancyNotes: input.discrepancyNotes.trim(),
  };
}

export type SubmitDeliveryInput = z.infer<typeof submitDeliveryInputSchema>;
export type ScheduleDeliveryInput = z.infer<typeof scheduleDeliveryInputSchema>;
export type RescheduleDeliveryInput = z.infer<
  typeof rescheduleDeliveryInputSchema
>;
export type VerifyDeliveryInput = z.infer<typeof verifyDeliveryInputSchema>;
export type RejectDeliveryInput = z.infer<typeof rejectDeliveryInputSchema>;
