import { z } from "zod";

const scale = BigInt(10_000);
export const maxAvailabilitySplits = 20;
export const availabilityQuantity = /^\d{1,14}(?:\.\d{1,4})?$/;

export function quantityUnits(value: string): bigint | null {
  if (!availabilityQuantity.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(4, "0"));
}

export function formatQuantityUnits(value: bigint): string {
  const fraction = String(value % scale).padStart(4, "0").replace(/0+$/, "");
  return String(value / scale) + (fraction ? "." + fraction : "");
}

export function totalAvailability(splits: { quantity: string }[]): string {
  return formatQuantityUnits(splits.reduce((sum, row) => sum + (quantityUnits(row.quantity) ?? BigInt(0)), BigInt(0)));
}

export const availabilitySplitSchema = z.object({
  quantity: z.string().trim().regex(availabilityQuantity, "Enter up to four decimal places.")
    .refine((value) => (quantityUnits(value) ?? BigInt(0)) > 0, "Each date needs a positive quantity."),
  date: z.iso.date("Enter a valid availability date."),
});

export const availabilitySplitsSchema = z.array(availabilitySplitSchema).min(1).max(maxAvailabilitySplits)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.date)).size !== rows.length) {
      context.addIssue({ code: "custom", message: "Combine quantities for the same date into one row." });
    }
    if (!availabilityQuantity.test(totalAvailability(rows))) {
      context.addIssue({ code: "custom", message: "The total quantity is too large." });
    }
  }).transform((rows) => [...rows].sort((a, b) => a.date.localeCompare(b.date)));

export type AvailabilitySplit = z.infer<typeof availabilitySplitSchema>;

export function readAvailabilitySplits(value: unknown): AvailabilitySplit[] {
  return availabilitySplitsSchema.safeParse(value).data ?? [];
}
