import { describe, expect, it } from "vitest";

import { hashAllocatePayload } from "./idempotency";

describe("allocate idempotency hash", () => {
  it("is stable across line sort order", () => {
    const a = hashAllocatePayload({
      supplierId: "sup_1",
      lines: [
        { availabilityOfferId: "o2", quantity: "5" },
        { availabilityOfferId: "o1", quantity: "3" },
      ],
    });
    const b = hashAllocatePayload({
      supplierId: "sup_1",
      lines: [
        { availabilityOfferId: "o1", quantity: "3" },
        { availabilityOfferId: "o2", quantity: "5" },
      ],
    });
    expect(a).toBe(b);
  });

  it("changes when quantity changes", () => {
    const a = hashAllocatePayload({
      supplierId: "sup_1",
      lines: [{ availabilityOfferId: "o1", quantity: "3" }],
    });
    const b = hashAllocatePayload({
      supplierId: "sup_1",
      lines: [{ availabilityOfferId: "o1", quantity: "4" }],
    });
    expect(a).not.toBe(b);
  });

  it("includes the selected date and replays reordered splits for the same offer", () => {
    const first = { availabilityOfferId: "o1", quantity: "2.0001", splitDate: "2026-12-05" };
    const second = { availabilityOfferId: "o1", quantity: "3", splitDate: "2026-12-06" };
    const hash = (lines: (typeof first)[]) => hashAllocatePayload({ supplierId: "sup_1", lines });
    expect(hash([first, second])).toBe(hash([second, first]));
    expect(hash([first, second])).not.toBe(hash([first, { ...second, splitDate: "2026-12-07" }]));
  });
});
