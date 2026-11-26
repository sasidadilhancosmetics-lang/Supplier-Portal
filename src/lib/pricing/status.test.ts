import { describe, expect, it } from "vitest";

import {
  canTransition,
  isAgreedPriceStatus,
} from "./status";

describe("price agreement status", () => {
  it("treats only confirmed/attested as agreed for allocate", () => {
    expect(isAgreedPriceStatus("SUPPLIER_CONFIRMED")).toBe(true);
    expect(isAgreedPriceStatus("STAFF_ATTESTED_AGREED")).toBe(true);
    expect(isAgreedPriceStatus("QUOTED")).toBe(false);
    expect(isAgreedPriceStatus("COUNTER_PENDING")).toBe(false);
    expect(isAgreedPriceStatus("STAFF_RECORDED_UNCONFIRMED")).toBe(false);
  });

  it("allows portal counter and accept path", () => {
    expect(canTransition("QUOTED", "COUNTER_PENDING")).toBe(true);
    expect(canTransition("COUNTER_PENDING", "SUPPLIER_CONFIRMED")).toBe(true);
    expect(canTransition("COUNTER_PENDING", "QUOTED")).toBe(true);
  });

  it("allows phone/whatsapp record then attest", () => {
    expect(canTransition("QUOTED", "STAFF_RECORDED_UNCONFIRMED")).toBe(true);
    expect(
      canTransition("STAFF_RECORDED_UNCONFIRMED", "STAFF_ATTESTED_AGREED"),
    ).toBe(true);
    expect(canTransition("QUOTED", "STAFF_ATTESTED_AGREED")).toBe(false);
  });

  it("rejects supersede as a live target from most states incorrectly", () => {
    expect(canTransition("SUPERSEDED", "QUOTED")).toBe(false);
  });
});
