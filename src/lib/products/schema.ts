import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const productPrioritySchema = z.enum(["NORMAL", "HIGH", "CRITICAL"]);
export const productMasterStatusSchema = z.enum(["PROVISIONAL", "ERP_LINKED"]);

export const updateProductSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1, "Product name is required").max(200),
  brandId: z.string().min(1, "Brand is required"),
  sku: optionalText,
  unitOfMeasure: optionalText,
  priorityStatus: productPrioritySchema,
  isActive: z.boolean(),
});

function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const productListQuerySchema = z.object({
  q: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null) return "";
    return String(first).trim();
  }, z.string().max(200).default("")),
  brandId: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return undefined;
    return String(first);
  }, z.string().min(1).optional()),
  masterStatus: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return undefined;
    return first;
  }, productMasterStatusSchema.optional()),
  page: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return 1;
    return first;
  }, z.coerce.number().int().min(1).default(1)),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
