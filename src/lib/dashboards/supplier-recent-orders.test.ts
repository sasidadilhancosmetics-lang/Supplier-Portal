import { describe, expect, it } from "vitest";

import {
  buildSupplierAvailabilityOrderStats,
  mapSupplierRecentOrderRows,
} from "./supplier-recent-orders";

describe("supplier recent orders dashboard mapping", () => {
  it("includes Delivered POs in Recent Orders while actionable counts stay zero", () => {
    const recentOrders = mapSupplierRecentOrderRows([
      {
        id: "po_a",
        orderNumber: "PO-20261116-260A4C29",
        status: "DELIVERED",
        itemCount: 2,
        createdAt: new Date("2026-11-16T06:57:51.803Z"),
      },
      {
        id: "po_b",
        orderNumber: "PO-20261112-E5D42983",
        status: "DELIVERED",
        itemCount: 1,
        createdAt: new Date("2026-11-12T07:53:06.673Z"),
      },
    ]);

    expect(recentOrders).toHaveLength(2);
    expect(recentOrders[0]).toMatchObject({
      title: "PO-20261116-260A4C29",
      href: "/supplier/orders/po_a",
    });
    expect(recentOrders[0].meta).toContain("Delivered");
    expect(recentOrders[1].title).toBe("PO-20261112-E5D42983");

    // Simulate a supplier that only has Delivered POs: list shows them,
    // but SENT / open-delivery counters remain zero.
    const stats = buildSupplierAvailabilityOrderStats({
      openRequests: 0,
      responded: 0,
      ordersAwaitingConfirm: 0,
      confirmedInDelivery: 0,
    });

    expect(stats.find((s) => s.id === "po-sent")?.value).toBe(0);
    expect(stats.find((s) => s.id === "po-open")?.value).toBe(0);
    expect(recentOrders.length).toBeGreaterThan(0);
  });
});
