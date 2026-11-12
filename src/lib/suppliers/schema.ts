import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalLongText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalEmail = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().email("Enter a valid email").optional(),
);

export const supplierStatusSchema = z.enum([
  "PENDING_REVIEW",
  "ACTIVE",
  "INACTIVE",
  "REJECTED",
]);

/** Ordinary activate/deactivate — never registration reject via this path. */
export const supplierOperationalStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const supplierProfileSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  contactName: optionalText,
  contactEmail: optionalEmail,
  contactPhone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  region: optionalText,
  postalCode: optionalText,
  country: optionalText,
  notes: optionalLongText,
  supportsAllBrands: z.boolean(),
  brandIds: z.array(z.string().min(1)).default([]),
});

export const createSupplierSchema = supplierProfileSchema;

export const updateSupplierSchema = supplierProfileSchema.extend({
  supplierId: z.string().min(1),
});

export const supplierStatusChangeSchema = z.object({
  supplierId: z.string().min(1),
  status: supplierOperationalStatusSchema,
});

/** Self-registration form — contact name required; address/notes optional. */
export const supplierSelfRegistrationSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  contactName: z
    .string()
    .trim()
    .min(1, "Contact name is required")
    .max(200),
  contactEmail: optionalEmail,
  contactPhone: optionalText,
  supportsAllBrands: z.boolean(),
  brandIds: z.array(z.string().min(1)).default([]),
});

export const rejectSupplierRegistrationSchema = z.object({
  supplierId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(3, "Enter a rejection reason")
    .max(2000),
});

/** Normalize Next.js searchParams values (string | string[] | undefined). */
function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * List filters from the URL.
 * Empty `status=` (All) must become undefined — not fail the enum.
 */
export const supplierListQuerySchema = z.object({
  q: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null) {
      return "";
    }
    return String(first).trim();
  }, z.string().max(200).default("")),
  status: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") {
      return undefined;
    }
    return first;
  }, supplierStatusSchema.optional()),
  page: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") {
      return 1;
    }
    return first;
  }, z.coerce.number().int().min(1).default(1)),
});

export type SupplierProfileInput = z.infer<typeof supplierProfileSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
