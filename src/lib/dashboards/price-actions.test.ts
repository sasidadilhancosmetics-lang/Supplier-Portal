import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prisma, loadRequirementCoverage } = vi.hoisted(() => ({
  prisma: {
    availabilityOffer: { findMany: vi.fn() },
  },
  loadRequirementCoverage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/dates", () => ({
  formatDateTime: (d: Date) => d.toISOString(),
}));
vi.mock("@/lib/orders/coverage", () => ({
  loadRequirementCoverage,
}));

import { loadCompanyPriceActionItems } from "./price-actions";

describe("loadCompanyPriceActionItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRequirementCoverage.mockResolvedValue(
      new Map([
        [
          "req_item_1",
          {
            requirementItemId: "req_item_1",
            quantityPlanned: { toString: () => "10" },
            netOrdered: { toString: () => "0" },
            remainingPlan: { toString: () => "10" },
          },
        ],
        [
          "req_item_2",
          {
            requirementItemId: "req_item_2",
            quantityPlanned: { toString: () => "5" },
            netOrdered: { toString: () => "0" },
            remainingPlan: { toString: () => "5" },
          },
        ],
      ]),
    );
  });

  it("scopes to company and separates confirmed vs revised", async () => {
    const future = new Date(Date.now() + 86400000);
    prisma.availabilityOffer.findMany.mockResolvedValue([
      {
        id: "offer_confirmed",
        status: "SUBMITTED",
        unitPrice: { toString: () => "90" },
        currencyCode: "LKR",
        quantityDeclared: { toString: () => "10" },
        quantityOrderedActive: { toString: () => "0" },
        reserveExpiresAt: future,
        updatedAt: new Date(),
        supplier: { name: "Acme" },
        requestItem: {
          supplierRequestId: "sr_1",
          requirementItemId: "req_item_1",
          product: { name: "Serum" },
        },
        priceAgreement: {
          status: "SUPPLIER_CONFIRMED",
          unitPrice: { toString: () => "90" },
          currencyCode: "LKR",
          updatedAt: new Date(),
          currentQuote: { kind: "SUPPLIER_ACCEPTANCE" },
        },
      },
      {
        id: "offer_revised",
        status: "SUBMITTED",
        unitPrice: { toString: () => "95" },
        currencyCode: "LKR",
        quantityDeclared: { toString: () => "5" },
        quantityOrderedActive: { toString: () => "0" },
        reserveExpiresAt: future,
        updatedAt: new Date(),
        supplier: { name: "Acme" },
        requestItem: {
          supplierRequestId: "sr_2",
          requirementItemId: "req_item_2",
          product: { name: "Cream" },
        },
        priceAgreement: {
          status: "QUOTED",
          unitPrice: { toString: () => "95" },
          currencyCode: "LKR",
          updatedAt: new Date(),
          currentQuote: { kind: "SUPPLIER_REVISED" },
        },
      },
      {
        id: "offer_allocated",
        status: "SUBMITTED",
        unitPrice: { toString: () => "88" },
        currencyCode: "LKR",
        quantityDeclared: { toString: () => "10" },
        quantityOrderedActive: { toString: () => "10" },
        reserveExpiresAt: future,
        updatedAt: new Date(),
        supplier: { name: "Acme" },
        requestItem: {
          supplierRequestId: "sr_3",
          requirementItemId: "req_item_1",
          product: { name: "Toner" },
        },
        priceAgreement: {
          status: "SUPPLIER_CONFIRMED",
          unitPrice: { toString: () => "88" },
          currencyCode: "LKR",
          updatedAt: new Date(),
          currentQuote: { kind: "SUPPLIER_ACCEPTANCE" },
        },
      },
    ]);

    const result = await loadCompanyPriceActionItems("co_1");

    expect(prisma.availabilityOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestItem: { companyId: "co_1" },
        }),
      }),
    );
    expect(result.confirmedForReview).toHaveLength(1);
    expect(result.confirmedForReview[0]?.readyForAllocation).toBe(true);
    expect(result.confirmedForReview[0]?.hrefAllocate).toContain(
      "requestId=sr_1",
    );
    expect(result.revisedAwaitingDecision).toHaveLength(1);
    expect(result.revisedAwaitingDecision[0]?.hrefAllocate).toBeNull();
    expect(result.counts.readyForAllocation).toBe(1);
    expect(result.counts.confirmedForReview).toBe(1);
  });

  it("does not list fully covered confirmed offers as actionable", async () => {
    const future = new Date(Date.now() + 86400000);
    loadRequirementCoverage.mockResolvedValue(
      new Map([
        [
          "req_covered",
          {
            requirementItemId: "req_covered",
            quantityPlanned: { toString: () => "10" },
            netOrdered: { toString: () => "10" },
            remainingPlan: { toString: () => "0" },
          },
        ],
      ]),
    );
    prisma.availabilityOffer.findMany.mockResolvedValue([
      {
        id: "offer_leftover",
        status: "SUBMITTED",
        unitPrice: { toString: () => "90" },
        currencyCode: "LKR",
        quantityDeclared: { toString: () => "20" },
        quantityOrderedActive: { toString: () => "10" },
        reserveExpiresAt: future,
        updatedAt: new Date(),
        supplier: { name: "Buddy Store" },
        requestItem: {
          supplierRequestId: "sr_buddy",
          requirementItemId: "req_covered",
          product: { name: "Ceravie Moisture" },
        },
        priceAgreement: {
          status: "SUPPLIER_CONFIRMED",
          unitPrice: { toString: () => "90" },
          currencyCode: "LKR",
          updatedAt: new Date(),
          currentQuote: { kind: "SUPPLIER_ACCEPTANCE" },
        },
      },
    ]);

    const result = await loadCompanyPriceActionItems("co_1");
    expect(result.confirmedForReview).toHaveLength(0);
    expect(result.counts.readyForAllocation).toBe(0);
    expect(result.counts.confirmedForReview).toBe(0);
  });

  it("does not label Ready for Allocation when reserve expired", async () => {
    const past = new Date(Date.now() - 86400000);
    prisma.availabilityOffer.findMany.mockResolvedValue([
      {
        id: "offer_expired",
        status: "SUBMITTED",
        unitPrice: { toString: () => "90" },
        currencyCode: "LKR",
        quantityDeclared: { toString: () => "10" },
        quantityOrderedActive: { toString: () => "0" },
        reserveExpiresAt: past,
        updatedAt: new Date(),
        supplier: { name: "Acme" },
        requestItem: {
          supplierRequestId: "sr_1",
          requirementItemId: "req_item_1",
          product: { name: "Serum" },
        },
        priceAgreement: {
          status: "SUPPLIER_CONFIRMED",
          unitPrice: { toString: () => "90" },
          currencyCode: "LKR",
          updatedAt: new Date(),
          currentQuote: { kind: "SUPPLIER_ACCEPTANCE" },
        },
      },
    ]);

    const result = await loadCompanyPriceActionItems("co_1");
    expect(result.confirmedForReview).toHaveLength(1);
    expect(result.confirmedForReview[0]?.readyForAllocation).toBe(false);
    expect(result.confirmedForReview[0]?.hrefAllocate).toBeNull();
    expect(result.counts.readyForAllocation).toBe(0);
    expect(result.counts.confirmedForReview).toBe(1);
  });
});
