import { describe, expect, it } from "vitest";

import {
  createDeliveryIdempotencyKey,
  emptyDeliverNowQuantities,
  rotateDeliveryIdempotencyKey,
} from "./idempotency-client";

describe("delivery idempotency client helpers", () => {
  it("creates UUID keys and rotates to a different key after success", () => {
    const first = createDeliveryIdempotencyKey();
    const second = rotateDeliveryIdempotencyKey();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(second).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(second).not.toBe(first);
  });

  it("never prefills Deliver Now quantities", () => {
    expect(emptyDeliverNowQuantities(["oi_1", "oi_2"])).toEqual({
      oi_1: "",
      oi_2: "",
    });
  });
});
