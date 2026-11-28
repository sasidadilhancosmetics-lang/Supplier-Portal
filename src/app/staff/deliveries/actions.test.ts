import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyDelivery, revalidatePath } = vi.hoisted(() => ({
  verifyDelivery: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/deliveries/verify", () => ({ verifyDelivery, rejectDelivery: vi.fn() }));
vi.mock("@/lib/deliveries/approve", () => ({ approveDeliverySchedule: vi.fn() }));

import { AuthorizationError } from "@/lib/auth/errors";
import { DeliveryDomainError } from "@/lib/deliveries/errors";
import { verifyDeliveryAction } from "./actions";

function receiptForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deliveryId: "fixture-delivery", receivedAt: "2026-11-28", deliveryItemId: "fixture-line",
    quantityReceived: "10", discrepancyNotes: "private fixture note",
  })) form.set(key, value);
  return form;
}

describe("receipt action error diagnostics", () => {
  const result = { deliveryId: "fixture-delivery", purchaseOrderId: "fixture-po", grnId: "fixture-grn", hasDiscrepancy: false };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    verifyDelivery.mockResolvedValue(result);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the saved GRN and revalidates only after verification succeeds", async () => {
    expect(await verifyDeliveryAction(undefined, receiptForm())).toEqual({ ok: true, ...result });
    expect(verifyDelivery).toHaveBeenCalledWith(expect.objectContaining({
      receivedAt: "2026-11-28", lines: [{ deliveryItemId: "fixture-line", quantityReceived: "10" }],
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/staff/deliveries/fixture-delivery");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reproduces the generic failure while reporting only the service phase and safe Prisma code", async () => {
    const error = Object.assign(new Error("private credentials and query fixture@example.invalid"), {
      name: "PrismaClientKnownRequestError", code: "P2028", meta: { secret: "private" },
    });
    verifyDelivery.mockRejectedValue(error);
    expect(await verifyDeliveryAction(undefined, receiptForm())).toEqual({ ok: false, message: "Something went wrong. Please try again." });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[receipt] unexpected_failure", {
      phase: "verify", errorType: "PrismaClientKnownRequestError", code: "P2028",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|fixture|credentials|query/);
  });

  it("distinguishes a refresh failure after the service has committed, without invoking verify twice", async () => {
    revalidatePath.mockImplementation(() => { throw new TypeError("private cache context"); });
    await verifyDeliveryAction(undefined, receiptForm());
    expect(verifyDelivery).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[receipt] unexpected_failure", {
      phase: "revalidate_after_commit", errorType: "TypeError", code: "UNCLASSIFIED",
    });
  });

  it.each([
    new DeliveryDomainError("VALIDATION", "Enter the actual receipt date.", { fieldErrors: { receivedAt: "Required" } }),
    new AuthorizationError("UNAUTHENTICATED"),
  ])("preserves expected validation/authorization failures without unexpected-error diagnostics", async (error) => {
    verifyDelivery.mockRejectedValue(error);
    const outcome = await verifyDeliveryAction(undefined, receiptForm());
    expect(outcome.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never emits arbitrary exception names, codes or thrown values", async () => {
    verifyDelivery.mockRejectedValue(Object.assign(new Error("private"), { name: "private-user", code: "private-token" }));
    await verifyDeliveryAction(undefined, receiptForm());
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[receipt] unexpected_failure", {
      phase: "verify", errorType: "UnknownError", code: "UNCLASSIFIED",
    });
  });
});
