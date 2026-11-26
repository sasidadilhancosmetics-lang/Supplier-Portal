import { z } from "zod";
import { availabilityQuantity, availabilitySplitsSchema, quantityUnits } from "./availability-splits";

export const distributeModeSchema = z.enum(["ALL_MATCHING", "SELECTED"]);

export const quantityOverrideSchema = z.object({
  requirementItemId: z.string().min(1),
  quantityRequested: z.coerce
    .number()
    .finite()
    .gt(0, "Requested quantity must be greater than zero")
    .max(1_000_000_000),
});

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
  /** Optional per-item request qty. Defaults to RequirementItem.quantityPlanned. */
  quantityOverrides: z.array(quantityOverrideSchema).optional(),
  /** Required when any override exceeds planned qty. */
  acknowledgeOverQty: z.boolean().optional().default(false),
});

/** Empty / blank form values become undefined so optional coerce does not become 0. */
function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}

const availabilityLineBase = z
  .object({
    requestItemId: z.string().min(1),
    /** Empty / omitted / null = unanswered (never coerce "" → 0). */
    quantityDeclared: z.preprocess((value) => {
      if (value === "" || value === null || value === undefined) return null;
      return typeof value === "number" ? String(value) : value;
    }, z.union([z.null(), z.string().trim().regex(availabilityQuantity, "Enter a quantity with up to four decimal places.")]).optional()),
    splits: availabilitySplitsSchema.optional(),
    /** Unit price in LKR. Required on positive available qty; omit for Not Available. */
    unitPrice: z.preprocess((value) => {
      if (value === "" || value === null || value === undefined) return null;
      return value;
    }, z.union([z.null(), z.coerce.number().finite().gt(0)]).optional()),
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

function availabilityLine(requirePrice: boolean) {
  return availabilityLineBase.superRefine((line, ctx) => {
    const qty = line.quantityDeclared == null ? null : quantityUnits(line.quantityDeclared);
    if (line.notAvailable && line.splits) {
      ctx.addIssue({ code: "custom", path: ["splits"], message: "Remove the dates when marking not available." });
    }
    if (line.notAvailable || (!line.splits && qty === BigInt(0))) {
      if (line.unitPrice != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unitPrice"],
          message: "Do not enter a unit price when marking not available.",
        });
      }
      return;
    }
    if (requirePrice && (line.splits || (qty != null && qty > 0)) && (line.unitPrice == null || line.unitPrice <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitPrice"],
        message: "Unit price (LKR) is required when available quantity is positive.",
      });
    }
  });
}

export const availabilityLineInputSchema = availabilityLine(true);

export const saveAvailabilityDraftSchema = z.object({
  supplierRequestId: z.string().min(1),
  lines: z.array(availabilityLine(false)).min(1),
});

export const submitAvailabilitySchema = saveAvailabilityDraftSchema.extend({
  lines: z.array(availabilityLineInputSchema).min(1),
});

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
    const [root, index, field, , splitField] = issue.path;
    if (root !== "lines" || typeof index !== "number") {
      continue;
    }
    const requestItemId = lines[index]?.requestItemId;
    if (!requestItemId || typeof field !== "string") {
      continue;
    }

    const key =
      field === "quantityDeclared" || (field === "splits" && splitField !== "date")
        ? `${requestItemId}:quantity`
        : field === "availableDate" || field === "splits"
          ? `${requestItemId}:date`
          : field === "expectedVersion"
            ? `${requestItemId}:version`
            : field === "unitPrice"
              ? `${requestItemId}:unitPrice`
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
  }, z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        value === "ACTION_REQUIRED" ||
        value === "ALL" ||
        [
          "NEW",
          "PARTIALLY_RESPONDED",
          "RESPONDED",
          "CLOSED",
          "CANCELLED",
        ].includes(value),
      "Invalid status filter",
    )),
  page: z.preprocess((value) => {
    const first = firstQueryValue(value);
    if (first === undefined || first === null || first === "") return 1;
    return first;
  }, z.coerce.number().int().min(1).default(1)),
});
