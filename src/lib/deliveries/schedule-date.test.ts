import { describe, expect, it } from "vitest";

import { isPastPortalCalendarDate, todayCalendarDateInPortalTz } from "@/lib/dates";

import { scheduleDeliveryInputSchema } from "./schema";

describe("schedule delivery dates", () => {
  it("accepts today and future planned dates in schema shape", () => {
    const today = todayCalendarDateInPortalTz();
    const parsed = scheduleDeliveryInputSchema.safeParse({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      purchaseOrderId: "po_1",
      plannedDeliveryAt: today,
      confirmed: true,
      lines: [{ orderItemId: "oi_1", quantity: "4" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("marks calendar days before today as past", () => {
    expect(isPastPortalCalendarDate("2020-01-01")).toBe(true);
    expect(isPastPortalCalendarDate(todayCalendarDateInPortalTz())).toBe(false);
  });
});
