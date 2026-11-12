import { z } from "zod";

export const distributeModeSchema = z.enum(["ALL_MATCHING", "SELECTED"]);

export const distributeRequirementSchema = z.object({
  requirementId: z.string().min(1),
  mode: distributeModeSchema,
  supplierIds: z.array(z.string().min(1)).default([]),
  responseDeadline: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .refine(
      (value) => value === undefined || !Number.isNaN(Date.parse(value)),
      "Invalid response deadline",
    ),
});

/** Empty / blank form values become undefined so optional coerce does not become 0. */
function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}

export const availabilityLineInputSchema = z.object({
  requestItemId: z.string().min(1),
  /** Empty / omitted / null = unanswered (never coerce "" → 0). */
  quantityDeclared: z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return null;
    return value;
  }, z.union([z.null(), z.coerce.number().finite().min(0)]).optional()),
  availableDate: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  notAvailable: z.boolean().default(false),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  /** Absent until an offer exists; empty hidden input must not coerce to 0. */
  expectedVersion: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).optional(),
  ),
});

export const saveAvailabilityDraftSchema = z.object({
  supplierRequestId: z.string().min(1),
  lines: z.array(availabilityLineInputSchema).min(1),
});

export const submitAvailabilitySchema = saveAvailabilityDraftSchema;

export type AvailabilityFieldErrors = Record<string, string>;

/**
 * Map Zod issues onto per-line field keys: `${requestItemId}:quantity|date|version|notes`.
 */
export function availabilityFieldErrorsFromZod(
  error: z.ZodError,
  lines: Array<{ requestItemId?: string }>,
): AvailabilityFieldErrors {
  const fieldErrors: AvailabilityFieldErrors = {};

  for (const issue of error.issues) {
    const [root, index, field] = issue.path;
    if (root !== "lines" || typeof index !== "number") {
      continue;
    }
    const requestItemId = lines[index]?.requestItemId;
    if (!requestItemId || typeof field !== "string") {
      continue;
    }

    const key =
      field === "quantityDeclared"
        ? `${requestItemId}:quantity`
        : field === "availableDate"
          ? `${requestItemId}:date`
          : field === "expectedVersion"
            ? `${requestItemId}:version`
            : field === "notes"
              ? `${requestItemId}:notes`
              : `${requestItemId}:${field}`;

    if (!fieldErrors[key]) {
      fieldErrors[key] =
        field === "expectedVersion"
          ? "This line was updated elsewhere. Reload and try again."
          : issue.message;
    }
  }

  return fieldErrors;
}

function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const supplierRequestListQuerySchema = z.object({
  status: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return undefined;
    return String(first);
  }, z.string().optional()),
  page: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return 1;
    return first;
  }, z.coerce.number().int().min(1).default(1)),
});
