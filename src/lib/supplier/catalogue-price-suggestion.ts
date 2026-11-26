type SavedPrice = {
  unitPrice: string;
  moq: string | null;
  unitOfMeasure: string | null;
  currencyCode: string;
};

export function compatibleCataloguePrice(saved: SavedPrice | undefined, unit: string | null) {
  const basis = saved?.unitOfMeasure?.trim();
  if (!saved || saved.currencyCode !== "LKR" || !basis || basis !== unit?.trim()) return null;
  return { unitPrice: saved.unitPrice, moq: saved.moq };
}

function scaledQuantity(value: string) {
  if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(4, "0"));
}

export function meetsCatalogueMoq(quantity: string, moq: string) {
  const offered = scaledQuantity(quantity);
  const minimum = scaledQuantity(moq);
  return offered !== null && minimum !== null && offered >= minimum;
}
