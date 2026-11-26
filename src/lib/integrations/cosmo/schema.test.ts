import { describe, expect, it } from "vitest";

import { COSMO_OSF_MAX_REQUEST_SUGGESTIONS } from "./constants";
import { CosmoIngestError } from "./errors";
import {
  assertContractHeaders,
  canonicalOsfPushPayload,
  hashOsfPushPayload,
  parseCosmoOsfPushPayload,
} from "./schema";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "cosmo-osf-push.v1",
    idempotencyKey: "idem-key-001",
    source: {
      system: "cosmo-os",
      cosmoCompanyId: "cosmo-co-1",
      sentAt: "2026-11-13T04:00:00.000Z",
    },
    selection: { mode: "SUPPLIER_ORDERS_SELECTION" },
    items: [
      {
        lineKey: "SKU-1",
        sku: "SKU-1",
        description: "Serum",
        brand: { cosmoVendorId: "vnd_1", name: "Buddy Brand" },
        priorities: { erp1: "Top Priority", erp2: null },
        quantity: { totalOrderQty: 10 },
      },
    ],
    ...overrides,
  };
}

describe("cosmo-osf-push.v1 schema", () => {
  it("accepts a valid payload and hashes deterministically", () => {
    const a = parseCosmoOsfPushPayload(validPayload());
    const b = parseCosmoOsfPushPayload(validPayload());
    expect(hashOsfPushPayload(a)).toBe(hashOsfPushPayload(b));
  });

  it("rejects duplicate SKUs", () => {
    expect(() =>
      parseCosmoOsfPushPayload(
        validPayload({
          items: [
            {
              lineKey: "A",
              sku: "SAME",
              description: "one",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: 1 },
            },
            {
              lineKey: "B",
              sku: "SAME",
              description: "two",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: 2 },
            },
          ],
        }),
      ),
    ).toThrow(CosmoIngestError);
    try {
      parseCosmoOsfPushPayload(
        validPayload({
          items: [
            {
              lineKey: "A",
              sku: "SAME",
              description: "one",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: 1 },
            },
            {
              lineKey: "B",
              sku: "SAME",
              description: "two",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: 2 },
            },
          ],
        }),
      );
    } catch (e) {
      expect(e).toBeInstanceOf(CosmoIngestError);
      expect((e as CosmoIngestError).code).toBe("VALIDATION");
    }
  });

  it("rejects negative and non-integer quantities", () => {
    expect(() =>
      parseCosmoOsfPushPayload(
        validPayload({
          items: [
            {
              lineKey: "A",
              sku: "A",
              description: "x",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: -1 },
            },
          ],
        }),
      ),
    ).toThrow(CosmoIngestError);

    expect(() =>
      parseCosmoOsfPushPayload(
        validPayload({
          items: [
            {
              lineKey: "A",
              sku: "A",
              description: "x",
              brand: { cosmoVendorId: "v", name: "B" },
              quantity: { totalOrderQty: 1.5 },
            },
          ],
        }),
      ),
    ).toThrow(CosmoIngestError);
  });

  it("allows zero quantity (preserved as a line later)", () => {
    const payload = parseCosmoOsfPushPayload(
      validPayload({
        items: [
          {
            lineKey: "Z",
            sku: "Z",
            description: "zero",
            brand: { cosmoVendorId: "v", name: "B" },
            quantity: { totalOrderQty: 0 },
          },
        ],
      }),
    );
    expect(payload.items[0]!.quantity.totalOrderQty).toBe(0);
  });

  it("rejects more than 500 items", () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      lineKey: `L${i}`,
      sku: `S${i}`,
      description: "x",
      brand: { cosmoVendorId: "v", name: "B" },
      quantity: { totalOrderQty: 1 },
    }));
    expect(() => parseCosmoOsfPushPayload(validPayload({ items }))).toThrow(
      CosmoIngestError,
    );
  });

  it("requires matching contract and idempotency headers", () => {
    const payload = parseCosmoOsfPushPayload(validPayload());
    expect(() =>
      assertContractHeaders({
        contractVersionHeader: "wrong",
        idempotencyKeyHeader: payload.idempotencyKey,
        payload,
      }),
    ).toThrow(CosmoIngestError);

    expect(() =>
      assertContractHeaders({
        contractVersionHeader: "cosmo-osf-push.v1",
        idempotencyKeyHeader: "other-key",
        payload,
      }),
    ).toThrow(CosmoIngestError);

    expect(() =>
      assertContractHeaders({
        contractVersionHeader: "cosmo-osf-push.v1",
        idempotencyKeyHeader: payload.idempotencyKey,
        payload,
      }),
    ).not.toThrow();
  });

  it("changes hash when quantity changes", () => {
    const a = parseCosmoOsfPushPayload(validPayload());
    const b = parseCosmoOsfPushPayload(
      validPayload({
        items: [
          {
            lineKey: "SKU-1",
            sku: "SKU-1",
            description: "Serum",
            brand: { cosmoVendorId: "vnd_1", name: "Buddy Brand" },
            priorities: { erp1: "Top Priority", erp2: null },
            quantity: { totalOrderQty: 11 },
          },
        ],
      }),
    );
    expect(hashOsfPushPayload(a)).not.toBe(hashOsfPushPayload(b));
  });

  it("treats omitted and empty requestSuggestions as equivalent hashes", () => {
    const omitted = parseCosmoOsfPushPayload(validPayload());
    const empty = parseCosmoOsfPushPayload(
      validPayload({ requestSuggestions: [] }),
    );
    expect(omitted.requestSuggestions).toEqual([]);
    expect(empty.requestSuggestions).toEqual([]);
    expect(hashOsfPushPayload(omitted)).toBe(hashOsfPushPayload(empty));
    expect(
      Object.prototype.hasOwnProperty.call(
        canonicalOsfPushPayload(omitted),
        "requestSuggestions",
      ),
    ).toBe(false);
  });

  it("accepts multiple suppliers for one SKU and sorts suggestions in the hash", () => {
    const a = parseCosmoOsfPushPayload(
      validPayload({
        requestSuggestions: [
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "sup_b",
            cosmoSupplierName: "B",
            suggestedRequestQty: 2,
          },
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "sup_a",
            cosmoSupplierCode: "A1",
            cosmoSupplierName: "A",
            suggestedRequestQty: 3,
          },
        ],
      }),
    );
    const b = parseCosmoOsfPushPayload(
      validPayload({
        requestSuggestions: [
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "sup_a",
            cosmoSupplierCode: "A1",
            cosmoSupplierName: "A",
            suggestedRequestQty: 3,
          },
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "sup_b",
            cosmoSupplierName: "B",
            suggestedRequestQty: 2,
          },
        ],
      }),
    );
    expect(hashOsfPushPayload(a)).toBe(hashOsfPushPayload(b));
    const canonical = canonicalOsfPushPayload(a);
    expect(canonical.requestSuggestions).toEqual([
      {
        lineKey: "SKU-1",
        cosmoSupplierId: "sup_a",
        cosmoSupplierCode: "A1",
        cosmoSupplierName: "A",
        suggestedRequestQty: 3,
      },
      {
        lineKey: "SKU-1",
        cosmoSupplierId: "sup_b",
        cosmoSupplierCode: null,
        cosmoSupplierName: "B",
        suggestedRequestQty: 2,
      },
    ]);
  });

  it("rejects unknown lineKey, duplicate pairs, and invalid suggestion quantities", () => {
    expect(() =>
      parseCosmoOsfPushPayload(
        validPayload({
          requestSuggestions: [
            {
              lineKey: "MISSING",
              cosmoSupplierId: "s1",
              cosmoSupplierName: "S",
              suggestedRequestQty: 1,
            },
          ],
        }),
      ),
    ).toThrow(CosmoIngestError);

    expect(() =>
      parseCosmoOsfPushPayload(
        validPayload({
          requestSuggestions: [
            {
              lineKey: "SKU-1",
              cosmoSupplierId: "s1",
              cosmoSupplierName: "S",
              suggestedRequestQty: 1,
            },
            {
              lineKey: "SKU-1",
              cosmoSupplierId: "s1",
              cosmoSupplierName: "S",
              suggestedRequestQty: 2,
            },
          ],
        }),
      ),
    ).toThrow(CosmoIngestError);

    for (const qty of [0, -1, Number.NaN, 1.12345]) {
      expect(() =>
        parseCosmoOsfPushPayload(
          validPayload({
            requestSuggestions: [
              {
                lineKey: "SKU-1",
                cosmoSupplierId: "s1",
                cosmoSupplierName: "S",
                suggestedRequestQty: qty,
              },
            ],
          }),
        ),
      ).toThrow(CosmoIngestError);
    }
  });

  it("rejects oversized requestSuggestions arrays", () => {
    const requestSuggestions = Array.from(
      { length: COSMO_OSF_MAX_REQUEST_SUGGESTIONS + 1 },
      (_, i) => ({
        lineKey: "SKU-1",
        cosmoSupplierId: `sup_${i}`,
        cosmoSupplierName: `S${i}`,
        suggestedRequestQty: 1,
      }),
    );
    expect(() =>
      parseCosmoOsfPushPayload(validPayload({ requestSuggestions })),
    ).toThrow(CosmoIngestError);
  });

  it("changes hash when suggestion quantity or supplier changes", () => {
    const base = parseCosmoOsfPushPayload(
      validPayload({
        requestSuggestions: [
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "s1",
            cosmoSupplierName: "S",
            suggestedRequestQty: 4,
          },
        ],
      }),
    );
    const qtyChanged = parseCosmoOsfPushPayload(
      validPayload({
        requestSuggestions: [
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "s1",
            cosmoSupplierName: "S",
            suggestedRequestQty: 5,
          },
        ],
      }),
    );
    const supplierChanged = parseCosmoOsfPushPayload(
      validPayload({
        requestSuggestions: [
          {
            lineKey: "SKU-1",
            cosmoSupplierId: "s2",
            cosmoSupplierName: "S2",
            suggestedRequestQty: 4,
          },
        ],
      }),
    );
    expect(hashOsfPushPayload(base)).not.toBe(hashOsfPushPayload(qtyChanged));
    expect(hashOsfPushPayload(base)).not.toBe(
      hashOsfPushPayload(supplierChanged),
    );
  });
});
