import { describe, expect, it } from "vitest";

import {
  blockedBrandRemovals,
  brandsBeingRemoved,
  canDisableSupportsAllBrands,
} from "./brand-rules";

describe("brandsBeingRemoved", () => {
  it("returns ids present in current but not next", () => {
    expect(brandsBeingRemoved(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });
});

describe("blockedBrandRemovals", () => {
  it("blocks removing a brand with an active request", () => {
    expect(
      blockedBrandRemovals({
        currentBrandIds: ["a", "b"],
        nextBrandIds: ["a"],
        activeRequestBrandIds: ["b"],
      }),
    ).toEqual(["b"]);
  });

  it("allows removing a brand without an active request", () => {
    expect(
      blockedBrandRemovals({
        currentBrandIds: ["a", "b"],
        nextBrandIds: ["a"],
        activeRequestBrandIds: ["a"],
      }),
    ).toEqual([]);
  });
});

describe("canDisableSupportsAllBrands", () => {
  it("allows keeping or enabling All Brands", () => {
    expect(
      canDisableSupportsAllBrands({
        currentlySupportsAll: false,
        nextSupportsAll: true,
        nextBrandIds: [],
        activeRequestBrandIds: ["x"],
      }),
    ).toBe(true);
  });

  it("blocks turning off All Brands when an active request brand is not selected", () => {
    expect(
      canDisableSupportsAllBrands({
        currentlySupportsAll: true,
        nextSupportsAll: false,
        nextBrandIds: ["a"],
        activeRequestBrandIds: ["a", "b"],
      }),
    ).toBe(false);
  });

  it("allows turning off All Brands when remaining brands cover active requests", () => {
    expect(
      canDisableSupportsAllBrands({
        currentlySupportsAll: true,
        nextSupportsAll: false,
        nextBrandIds: ["a", "b"],
        activeRequestBrandIds: ["b"],
      }),
    ).toBe(true);
  });
});
