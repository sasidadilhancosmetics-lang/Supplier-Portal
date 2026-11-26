import { z } from "zod";

const positivePrice = z.coerce
  .number()
  .finite()
  .gt(0, "Unit price must be greater than zero")
  .max(1_000_000_000);

export const staffCounterOfferSchema = z.object({
  availabilityOfferId: z.string().min(1),
  unitPrice: positivePrice,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  expectedVersion: z.coerce.number().int().min(1),
});

export const supplierReviseOfferSchema = z.object({
  availabilityOfferId: z.string().min(1),
  unitPrice: positivePrice,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  expectedVersion: z.coerce.number().int().min(1),
});

export const supplierAcceptCounterSchema = z.object({
  availabilityOfferId: z.string().min(1),
  expectedVersion: z.coerce.number().int().min(1),
});

export const staffRecordExternalSchema = z.object({
  availabilityOfferId: z.string().min(1),
  unitPrice: positivePrice,
  channel: z.enum(["PHONE", "WHATSAPP"]),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  negotiationOccurredAt: z
    .string()
    .trim()
    .min(1, "Negotiation date is required")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid negotiation date"),
  expectedVersion: z.coerce.number().int().min(1),
});

export const staffAttestAgreementSchema = z.object({
  availabilityOfferId: z.string().min(1),
  attestationStatement: z
    .string()
    .trim()
    .min(10, "Attestation statement is required")
    .max(4000),
  evidenceNote: z
    .string()
    .trim()
    .min(3, "Confirmation evidence is required")
    .max(4000),
  expectedVersion: z.coerce.number().int().min(1),
});
