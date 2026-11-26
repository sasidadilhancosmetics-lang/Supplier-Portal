export function formatCataloguePrice({
  unitPrice,
  moq,
  unitOfMeasure,
}: {
  unitPrice: string | null;
  moq: string | null;
  unitOfMeasure?: string | null;
}): string {
  if (unitPrice === null) return "Price not set";

  // Catalogue prices have at most two decimal places. Pad the stored digits
  // without converting through a floating-point number.
  const [whole, fraction = ""] = unitPrice.split(".");
  const price = `LKR ${whole}.${fraction.padEnd(2, "0")}`;
  const unit = unitOfMeasure ? ` / ${unitOfMeasure}` : "";
  if (moq === null) return price + unit;

  const [quantity, decimal = ""] = moq.split(".");
  const significant = decimal.replace(/0+$/, "");
  const minimum = significant ? `${quantity}.${significant}` : quantity;
  return `${price}${unit} · MOQ ${minimum}`;
}
