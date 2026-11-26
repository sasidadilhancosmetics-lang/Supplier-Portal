import { describe, expect, it } from "vitest";

import { supplierRequestListAction } from "./request-list-actions";

describe("supplierRequestListAction", () => {
  it("labels NEW as Respond", () => {
    expect(
      supplierRequestListAction({ id: "r1", status: "NEW" }),
    ).toEqual({
      label: "Respond",
      href: "/supplier/requests/r1",
    });
  });

  it("labels PARTIALLY_RESPONDED as Continue", () => {
    expect(
      supplierRequestListAction({ id: "r1", status: "PARTIALLY_RESPONDED" })
        .label,
    ).toBe("Continue");
  });

  it("labels RESPONDED as View Response", () => {
    expect(
      supplierRequestListAction({ id: "r1", status: "RESPONDED" }).label,
    ).toBe("View Response");
  });

  it("keeps counter focus when a counteroffer is pending", () => {
    expect(
      supplierRequestListAction({
        id: "r1",
        status: "RESPONDED",
        hasPendingCounter: true,
      }),
    ).toEqual({
      label: "Respond",
      href: "/supplier/requests/r1?focus=counter",
    });
  });
});
