import { expect, it } from "vitest";
import { compatibleCataloguePrice, meetsCatalogueMoq } from "./catalogue-price-suggestion";

it("suggests only a saved LKR price on a known matching unit basis", () => {
  const saved = { unitPrice: "10.50", currencyCode: "LKR", unitOfMeasure: "Each", moq: "2" };
  expect(compatibleCataloguePrice(saved, "Each")).toEqual({ unitPrice: "10.50", moq: "2" });
  expect(compatibleCataloguePrice(saved, null)).toBeNull();
  expect(compatibleCataloguePrice(saved, "Box")).toBeNull();
  expect(compatibleCataloguePrice({ ...saved, currencyCode: "USD" }, "Each")).toBeNull();
});

it("checks the actual offered amount against MOQ without rounding", () => {
  expect(meetsCatalogueMoq("", "2")).toBe(false);
  expect(meetsCatalogueMoq("2.0000", "2")).toBe(true);
  expect(meetsCatalogueMoq("99999999999999.9998", "99999999999999.9999")).toBe(false);
});
