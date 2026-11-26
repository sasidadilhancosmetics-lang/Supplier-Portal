import { z } from "zod";

import {
  distributeModeSchema,
  quantityOverrideSchema,
} from "@/lib/requests/schema";

/** F2C: explicit per-supplier request lines. Empty items = ignore that supplier. */
export const distributeSupplierRecipientSchema = z.object({
  supplierId: z.string().min(1),
  items: z
    .array(
      z.object({
        requirementItemId: z.string().min(1),
        quantityRequested: z.coerce
          .number()
          .finite()
          .gt(0)
          .max(1_000_000_000),
      }),
    )
    .default([]),
});

export const distributeOsfBrandSchema = z.object({
  requirementId: z.string().min(1),
  mode: distributeModeSchema,
  supplierIds: z.array(z.string().min(1)).default([]),
  /** F1 shared overrides — applied to every recipient when supplierRecipients omitted. */
  quantityOverrides: z.array(quantityOverrideSchema).optional(),
  /**
   * F2C explicit recipients. When present (after filtering empty-item suppliers),
   * replaces ALL_MATCHING/SELECTED + shared quantityOverrides for this brand.
   */
  supplierRecipients: z.array(distributeSupplierRecipientSchema).optional(),
});

export const distributeOsfImportSchema = z.object({
  importId: z.string().min(1),
  idempotencyKey: z.string().trim().uuid("idempotencyKey must be a UUID"),
  responseDeadline: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine(
      (value) => value === undefined || !Number.isNaN(Date.parse(value)),
      "Invalid response deadline",
    ),
  acknowledgeOverQty: z.boolean().optional().default(false),
  /** When true, only process brands whose ledger is FAILED (or missing). */
  retryFailedOnly: z.boolean().optional().default(false),
  brands: z.array(distributeOsfBrandSchema).min(1),
});

export type DistributeOsfImportInput = z.infer<typeof distributeOsfImportSchema>;
