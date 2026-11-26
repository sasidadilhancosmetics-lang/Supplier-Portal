import { describe, expect, it } from "vitest";

import { verifyDeliveryInputSchema } from "./schema";

describe("verify received quantity UX safety", () => {
  const base = {
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deliveryId: "del_1",
  };

  it("rejects empty Received now (cannot issue GRN)", () => {
    const parsed = verifyDeliveryInputSchema.safeParse({
      ...base,
      lines: [{ deliveryItemId: "di_1", quantityReceived: "" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects missing/whitespace received quantity", () => {
    const parsed = verifyDeliveryInputSchema.safeParse({
      ...base,
      lines: [{ deliveryItemId: "di_1", quantityReceived: "   " }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts explicit zero received (notes enforced in verify service)", () => {
    const parsed = verifyDeliveryInputSchema.safeParse({
      ...base,
      lines: [{ deliveryItemId: "di_1", quantityReceived: "0" }],
      discrepancyNotes: "Nothing arrived",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts explicit positive received quantity", () => {
    const parsed = verifyDeliveryInputSchema.safeParse({
      ...base,
      lines: [{ deliveryItemId: "di_1", quantityReceived: "5" }],
    });
    expect(parsed.success).toBe(true);
  });
});
