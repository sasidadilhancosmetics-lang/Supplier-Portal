import { expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/deliveries/schedule", () => ({ scheduleDelivery: vi.fn() }));
vi.mock("@/lib/deliveries/reschedule", () => ({ rescheduleDelivery: vi.fn() }));

import { rescheduleDelivery } from "@/lib/deliveries/reschedule";
import { scheduleDelivery } from "@/lib/deliveries/schedule";
import { rescheduleDeliveryAction, scheduleDeliveryAction } from "./delivery-actions";

it("keeps a planned quantity on its own order line when a completed line is disabled", async () => {
  vi.mocked(scheduleDelivery).mockResolvedValue({
    deliveryId: "delivery", purchaseOrderId: "order", status: "SCHEDULED",
  });
  const form = new FormData();
  form.append("orderItemId", "received-line");
  form.append("orderItemId", "remaining-line");
  form.set("quantity:remaining-line", "5.25");

  await scheduleDeliveryAction(undefined, form);

  expect(scheduleDelivery).toHaveBeenCalledWith(expect.objectContaining({
    lines: [{ orderItemId: "remaining-line", quantity: "5.25" }],
  }));
});

it("keeps the original form input shape for reschedules", async () => {
  const form = new FormData();
  form.append("orderItemId", "first");
  form.append("orderItemId", "second");
  form.append("quantity", "");
  form.append("quantity", "5");

  await rescheduleDeliveryAction(undefined, form);

  expect(rescheduleDelivery).toHaveBeenCalledWith(expect.objectContaining({
    lines: [{ orderItemId: "second", quantity: "5" }],
  }));
});
