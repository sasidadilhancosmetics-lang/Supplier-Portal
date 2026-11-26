const hundred = BigInt(100);
const zero = BigInt(0);
const ten = BigInt(10);

type Decimal = { value: bigint; scale: bigint };
export type Coverage = { kind: "known"; stock: bigint; rop: bigint }
  | { kind: "unknown" }
  | { kind: "not-applicable" };

function decimal(input: string): Decimal | null {
  if (input.length > 130) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(input);
  if (!match) return null;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const places = fraction.length - Number(exponent);
  if (!Number.isSafeInteger(places) || Math.abs(places) > 400) return null;
  const value = BigInt(sign + whole + fraction);
  return places < 0
    ? { value: value * ten ** BigInt(-places), scale: BigInt(1) }
    : { value, scale: ten ** BigInt(places) };
}

export function parseCoverageThreshold(input: string): Decimal | null {
  const text = input.trim();
  if (!/^\d{1,3}(?:\.\d{1,12})?$/.test(text)) return null;
  const threshold = decimal(text);
  return threshold && threshold.value <= hundred * threshold.scale ? threshold : null;
}

export function stockCoverage(stock: string | null, rop: string | null): Coverage {
  const target = rop === null ? null : decimal(rop);
  if (!target || target.value < zero) return { kind: "unknown" };
  if (target.value === zero) return { kind: "not-applicable" };
  const actual = stock === null ? null : decimal(stock);
  if (!actual) return { kind: "unknown" };
  return { kind: "known", stock: actual.value * target.scale, rop: target.value * actual.scale };
}

export function isBelowCoverage(coverage: Coverage, threshold: Decimal): boolean {
  return coverage.kind === "known" && coverage.stock * hundred * threshold.scale < coverage.rop * threshold.value;
}

export function coverageLabel(coverage: Coverage): string {
  if (coverage.kind === "unknown") return "Unknown";
  if (coverage.kind === "not-applicable") return "N/A (ROP is zero)";
  const stock = coverage.stock;
  const rop = coverage.rop;
  const units = BigInt(10_000);
  const scaled = (stock < zero ? -stock : stock) * hundred * units;
  const value = scaled / rop;
  const fraction = String(value % units).padStart(4, "0").replace(/0+$/, "");
  return `${scaled % rop === zero ? "" : "≈"}${stock < zero ? "-" : ""}${value / units}${fraction ? "." + fraction : ""}%`;
}
