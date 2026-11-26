/**
 * Shared money/preview helpers used by server components and client allocate UI.
 * Must import the Prisma *browser* entry — `@/generated/prisma/client` pulls
 * Node builtins (`node:process` / runtime → `node:module`) and breaks Turbopack
 * client chunks (e.g. /staff/orders/allocate).
 */
import { Prisma } from "@/generated/prisma/browser";

/** Browser entry exports Decimal as a value; use instance type for annotations. */
type Decimal = InstanceType<typeof Prisma.Decimal>;

/** Includes server Prisma.Decimal (different constructor) via toString(). */
export type DecimalLike =
  | Decimal
  | string
  | number
  | { toString(): string };

function asDecimal(value: DecimalLike): Decimal {
  if (value instanceof Prisma.Decimal) return value
  if (typeof value === "string" || typeof value === "number") {
    return new Prisma.Decimal(value)
  }
  // Server Prisma.Decimal instances are not instanceof the browser constructor.
  return new Prisma.Decimal(value.toString())
}

/** Format a money amount for display (LKR default). Never invents values. */
export function formatOrderMoney(
  amount: DecimalLike,
  currencyCode: string | null | undefined = "LKR",
): string {
  const code = currencyCode?.trim() || "LKR";
  const n = asDecimal(amount);
  return `${n.toFixed(2)} ${code}`;
}

export type OrderLinePriceView = {
  hasPrice: boolean;
  unitPriceLabel: string;
  lineTotalLabel: string;
  /** Null when OrderItem.unitPrice was not snapshotted. */
  lineTotal: Decimal | null;
};

/**
 * Line pricing from the immutable OrderItem snapshot only.
 * Do not pass live AvailabilityOffer / PriceAgreement prices here.
 */
export function orderLinePriceView(args: {
  quantityOrdered: DecimalLike;
  unitPrice: DecimalLike | null | undefined;
  currencyCode?: string | null;
}): OrderLinePriceView {
  if (args.unitPrice == null) {
    return {
      hasPrice: false,
      unitPriceLabel: "Price not recorded",
      lineTotalLabel: "Price not recorded",
      lineTotal: null,
    };
  }
  const unit = asDecimal(args.unitPrice);
  const qty = asDecimal(args.quantityOrdered);
  const lineTotal = qty.mul(unit);
  const currency = args.currencyCode ?? "LKR";
  return {
    hasPrice: true,
    unitPriceLabel: formatOrderMoney(unit, currency),
    lineTotalLabel: formatOrderMoney(lineTotal, currency),
    lineTotal,
  };
}

export type OrderPriceTotalsView = {
  /** Sum of lines that have a snapshotted unit price. */
  totalLabel: string;
  hasAnyPrice: boolean;
  /** True when every line has a recorded unit price. */
  allLinesPriced: boolean;
  missingPriceCount: number;
};

/**
 * Parse allocate qty input for informational preview only.
 * Empty / non-numeric / non-positive → null (no line total).
 */
export function parseAllocateQuantityInput(
  raw: string | null | undefined,
): Decimal | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const n = new Prisma.Decimal(trimmed);
    if (!n.isFinite() || n.lessThanOrEqualTo(0)) return null;
    return n;
  } catch {
    return null;
  }
}

/** Informational line total: qty × agreed unit price (server remains authoritative). */
export function allocatePreviewLineTotal(args: {
  quantityInput: string | null | undefined;
  agreedUnitPrice: string | null | undefined;
}): Decimal | null {
  if (args.agreedUnitPrice == null || args.agreedUnitPrice === "") return null;
  const qty = parseAllocateQuantityInput(args.quantityInput);
  if (!qty) return null;
  try {
    return qty.mul(new Prisma.Decimal(args.agreedUnitPrice));
  } catch {
    return null;
  }
}

export function allocatePreviewOrderTotal(
  lineTotals: Array<Decimal | null>,
): Decimal | null {
  let total = new Prisma.Decimal(0);
  let any = false;
  for (const line of lineTotals) {
    if (line == null) continue;
    any = true;
    total = total.plus(line);
  }
  return any ? total : null;
}

export function orderPriceTotalsView(
  lines: Array<{ lineTotal: Decimal | null }>,
  currencyCode?: string | null,
): OrderPriceTotalsView {
  const currency = currencyCode ?? "LKR";
  let total = new Prisma.Decimal(0);
  let priced = 0;
  let missing = 0;
  for (const line of lines) {
    if (line.lineTotal == null) {
      missing += 1;
      continue;
    }
    priced += 1;
    total = total.plus(line.lineTotal);
  }
  if (priced === 0) {
    return {
      totalLabel: "Price not recorded",
      hasAnyPrice: false,
      allLinesPriced: lines.length === 0,
      missingPriceCount: missing,
    };
  }
  return {
    totalLabel: formatOrderMoney(total, currency),
    hasAnyPrice: true,
    allLinesPriced: missing === 0,
    missingPriceCount: missing,
  };
}
