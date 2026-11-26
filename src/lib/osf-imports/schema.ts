import { z } from "zod";

const positiveQty = z.coerce
  .number()
  .finite()
  .gt(0, "Planned quantity must be greater than zero")
  .max(1_000_000_000);

export const updateImportLineQtySchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  quantityPlanned: positiveQty,
});

export const linkImportLineProductSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  productId: z.string().min(1),
});

export const resolveImportLineBrandSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  brandId: z.string().min(1),
  /** When true, apply brand to all UNKNOWN_BRAND lines sharing the same Cosmo vendor+name. */
  applyToBrandGroup: z.boolean().default(true),
});

export const excludeImportLineSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().min(1, "Exclusion reason is required").max(500),
});

export const restoreImportLineSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
});

/** Explicit staff action to include a REJECTED_ZERO_QTY line with a new planned qty. */
export const includeZeroQtyLineSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  quantityPlanned: positiveQty,
});

export const createBrandAndResolveSchema = z.object({
  importId: z.string().min(1),
  lineId: z.string().min(1),
  lineVersion: z.coerce.number().int().min(1),
  importVersion: z.coerce.number().int().min(1),
  name: z.string().trim().min(1, "Brand name is required").max(200),
});

/** Phase E — atomic bulk confirm of all brand drafts on one import. */
export const confirmOsfImportSchema = z.object({
  importId: z.string().min(1),
  importVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().uuid("idempotencyKey must be a UUID"),
});

export type ConfirmOsfImportInput = z.infer<typeof confirmOsfImportSchema>;
