import { z } from "zod";

export const requirementStatusSchema = z.enum([
  "DRAFT",
  "CONFIRMED",
  "CANCELLED",
]);

const positiveQuantity = z.coerce
  .number()
  .finite()
  .gt(0, "Quantity must be greater than zero")
  .max(1_000_000_000);

export const requirementItemInputSchema = z.object({
  productId: z.string().min(1),
  quantityPlanned: positiveQuantity,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  externalLineId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export const createDraftRequirementSchema = z.object({
  brandId: z.string().min(1, "Brand is required"),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  items: z.array(requirementItemInputSchema).default([]),
  /** Optional OSF import linkage for future Cosmo OS adapter. */
  osfImportId: z.string().min(1).optional(),
});

export const updateDraftRequirementMetaSchema = z.object({
  requirementId: z.string().min(1),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export const addDraftRequirementItemSchema = z.object({
  requirementId: z.string().min(1),
  productId: z.string().min(1),
  quantityPlanned: positiveQuantity,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export const updateDraftRequirementItemSchema = z.object({
  requirementId: z.string().min(1),
  itemId: z.string().min(1),
  quantityPlanned: positiveQuantity,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export const removeDraftRequirementItemSchema = z.object({
  requirementId: z.string().min(1),
  itemId: z.string().min(1),
});

export const confirmRequirementSchema = z.object({
  requirementId: z.string().min(1),
});

function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const requirementListQuerySchema = z.object({
  q: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null) return "";
    return String(first).trim();
  }, z.string().max(200).default("")),
  status: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return undefined;
    return first;
  }, requirementStatusSchema.optional()),
  brandId: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return undefined;
    return String(first);
  }, z.string().min(1).optional()),
  page: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return 1;
    return first;
  }, z.coerce.number().int().min(1).default(1)),
});

export type CreateDraftRequirementInput = z.infer<
  typeof createDraftRequirementSchema
>;
