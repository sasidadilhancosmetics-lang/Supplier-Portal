import { describe, expect, it } from "vitest";

import {
  staffAttestAgreementSchema,
  staffCounterOfferSchema,
  staffRecordExternalSchema,
  supplierAcceptCounterSchema,
} from "./schema";

describe("pricing schemas", () => {
  it("requires positive counter price and version", () => {
    const ok = staffCounterOfferSchema.safeParse({
      availabilityOfferId: "o1",
      unitPrice: "12.50",
      expectedVersion: "2",
    });
    expect(ok.success).toBe(true);

    const bad = staffCounterOfferSchema.safeParse({
      availabilityOfferId: "o1",
      unitPrice: "0",
      expectedVersion: "1",
    });
    expect(bad.success).toBe(false);
  });

  it("requires phone/whatsapp channel, date, and price", () => {
    const ok = staffRecordExternalSchema.safeParse({
      availabilityOfferId: "o1",
      unitPrice: 100,
      channel: "WHATSAPP",
      negotiationOccurredAt: "2026-11-13T10:00",
      expectedVersion: 1,
    });
    expect(ok.success).toBe(true);

    const portal = staffRecordExternalSchema.safeParse({
      availabilityOfferId: "o1",
      unitPrice: 100,
      channel: "PORTAL",
      negotiationOccurredAt: "2026-11-13T10:00",
      expectedVersion: 1,
    });
    expect(portal.success).toBe(false);
  });

  it("requires attestation statement and evidence", () => {
    const ok = staffAttestAgreementSchema.safeParse({
      availabilityOfferId: "o1",
      attestationStatement: "Supplier confirmed on call with buyer.",
      evidenceNote: "Call log 13:00",
      expectedVersion: 3,
    });
    expect(ok.success).toBe(true);

    const short = staffAttestAgreementSchema.safeParse({
      availabilityOfferId: "o1",
      attestationStatement: "short",
      evidenceNote: "x",
      expectedVersion: 3,
    });
    expect(short.success).toBe(false);
  });

  it("accepts supplier acceptance payload", () => {
    const ok = supplierAcceptCounterSchema.parse({
      availabilityOfferId: "o1",
      expectedVersion: "4",
    });
    expect(ok.expectedVersion).toBe(4);
  });
});
