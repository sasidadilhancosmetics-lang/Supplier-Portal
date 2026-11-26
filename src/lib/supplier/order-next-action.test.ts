import { describe, expect, it } from "vitest";

import { resolveSupplierOrderNextAction } from "./order-next-action";

describe("resolveSupplierOrderNextAction", () => {
  it("asks for confirm when SENT", () => {
    expect(
      resolveSupplierOrderNextAction({
        id: "po1",
        status: "SENT",
        canSchedule: false,
        hasActiveSchedule: false,
      }),
    ).toEqual({
      label: "Review & Confirm",
      href: "/supplier/orders/po1",
    });
  });

  it("schedules when confirmed with remaining capacity", () => {
    expect(
      resolveSupplierOrderNextAction({
        id: "po1",
        status: "CONFIRMED",
        canSchedule: true,
        hasActiveSchedule: false,
      }).label,
    ).toBe("Schedule Delivery");
  });

  it("views schedule when fully scheduled", () => {
    expect(
      resolveSupplierOrderNextAction({
        id: "po1",
        status: "CONFIRMED",
        canSchedule: false,
        hasActiveSchedule: true,
      }).label,
    ).toBe("View Delivery Schedule");
  });

  it("schedules remaining when partially delivered with capacity", () => {
    expect(
      resolveSupplierOrderNextAction({
        id: "po1",
        status: "PARTIALLY_DELIVERED",
        canSchedule: true,
        hasActiveSchedule: false,
      }).label,
    ).toBe("Schedule Remaining");
  });

  it("only views details when delivered", () => {
    expect(
      resolveSupplierOrderNextAction({
        id: "po1",
        status: "DELIVERED",
        canSchedule: true,
        hasActiveSchedule: true,
      }),
    ).toEqual({
      label: "View Details",
      href: "/supplier/orders/po1",
    });
  });
});
