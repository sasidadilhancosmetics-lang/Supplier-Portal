import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createUserNotification: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";

import {
  assertAcknowledgeOverQtyForRecipients,
  buildQuantityByItemId,
  recipientsFromPlanned,
} from "./distribute-core";
import { RequestDomainError } from "./errors";

const items = [
  {
    id: "ri_1",
    quantityPlanned: "10",
    product: {
      id: "p1",
      name: "A",
      sku: "A",
      priorityStatus: "NORMAL",
    },
  },
  {
    id: "ri_2",
    quantityPlanned: "5",
    product: {
      id: "p2",
      name: "B",
      sku: "B",
      priorityStatus: "NORMAL",
    },
  },
];

describe("buildQuantityByItemId", () => {
  it("defaults to planned quantities", () => {
    const map = buildQuantityByItemId(items, undefined, false);
    expect(map.get("ri_1")?.toString()).toBe("10");
    expect(map.get("ri_2")?.toString()).toBe("5");
  });

  it("applies safe overrides at or below planned", () => {
    const map = buildQuantityByItemId(
      items,
      [{ requirementItemId: "ri_1", quantityRequested: 8 }],
      false,
    );
    expect(map.get("ri_1")?.equals(new Prisma.Decimal(8))).toBe(true);
    expect(map.get("ri_2")?.toString()).toBe("5");
  });

  it("requires acknowledge when override exceeds planned", () => {
    expect(() =>
      buildQuantityByItemId(
        items,
        [{ requirementItemId: "ri_1", quantityRequested: 11 }],
        false,
      ),
    ).toThrow(RequestDomainError);

    const map = buildQuantityByItemId(
      items,
      [{ requirementItemId: "ri_1", quantityRequested: 11 }],
      true,
    );
    expect(map.get("ri_1")?.toString()).toBe("11");
  });

  it("rejects unknown requirement items", () => {
    expect(() =>
      buildQuantityByItemId(
        items,
        [{ requirementItemId: "missing", quantityRequested: 1 }],
        false,
      ),
    ).toThrow(/Unknown requirement item/);
  });
});

describe("recipientsFromPlanned + over-qty totals", () => {
  it("expands shared map onto every recipient (F1)", () => {
    const map = buildQuantityByItemId(
      items,
      [{ requirementItemId: "ri_1", quantityRequested: 7 }],
      false,
    );
    const recipients = recipientsFromPlanned({
      recipients: [
        { id: "s1", name: "A" },
        { id: "s2", name: "B" },
      ],
      items,
      quantityByItemId: map,
    });
    expect(recipients).toHaveLength(2);
    expect(recipients[0]!.items[0]!.quantityRequested.toString()).toBe("7");
    expect(recipients[1]!.items[0]!.quantityRequested.toString()).toBe("7");
    expect(recipients[0]!.items[1]!.quantityRequested.toString()).toBe("5");
  });

  it("requires ack when supplier totals exceed planned", () => {
    const recipients = [
      {
        id: "s1",
        name: "A",
        items: [
          {
            requirementItemId: "ri_1",
            productId: "p1",
            quantityRequested: new Prisma.Decimal(6),
          },
        ],
      },
      {
        id: "s2",
        name: "B",
        items: [
          {
            requirementItemId: "ri_1",
            productId: "p1",
            quantityRequested: new Prisma.Decimal(5),
          },
        ],
      },
    ];
    expect(() =>
      assertAcknowledgeOverQtyForRecipients({
        items,
        recipients,
        acknowledgeOverQty: false,
      }),
    ).toThrow(RequestDomainError);

    expect(() =>
      assertAcknowledgeOverQtyForRecipients({
        items,
        recipients,
        acknowledgeOverQty: true,
      }),
    ).not.toThrow();
  });

  it("ignored supplier (empty items) does not contribute to totals", () => {
    expect(() =>
      assertAcknowledgeOverQtyForRecipients({
        items,
        recipients: [
          {
            id: "s1",
            name: "A",
            items: [
              {
                requirementItemId: "ri_1",
                productId: "p1",
                quantityRequested: new Prisma.Decimal(10),
              },
            ],
          },
          { id: "s2", name: "B", items: [] },
        ],
        acknowledgeOverQty: false,
      }),
    ).not.toThrow();
  });
});
