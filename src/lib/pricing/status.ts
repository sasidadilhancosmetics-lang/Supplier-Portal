import type { PriceAgreementStatus } from "@/generated/prisma/client";

/** Statuses that may be snapshotted onto OrderItem at allocate time. */
export const AGREED_PRICE_STATUSES = [
  "SUPPLIER_CONFIRMED",
  "STAFF_ATTESTED_AGREED",
] as const satisfies readonly PriceAgreementStatus[];

export type AgreedPriceStatus = (typeof AGREED_PRICE_STATUSES)[number];

export function isAgreedPriceStatus(
  status: PriceAgreementStatus,
): status is AgreedPriceStatus {
  return (AGREED_PRICE_STATUSES as readonly string[]).includes(status);
}

/** Allowed next statuses from the current agreement pointer status. */
const ALLOWED_TRANSITIONS: Record<
  PriceAgreementStatus,
  readonly PriceAgreementStatus[]
> = {
  QUOTED: [
    "COUNTER_PENDING",
    "STAFF_RECORDED_UNCONFIRMED",
    "SUPPLIER_CONFIRMED",
    "DECLINED",
    "SUPERSEDED",
  ],
  COUNTER_PENDING: [
    "QUOTED",
    "SUPPLIER_CONFIRMED",
    "DECLINED",
    "SUPERSEDED",
    "STAFF_RECORDED_UNCONFIRMED",
  ],
  STAFF_RECORDED_UNCONFIRMED: [
    "STAFF_ATTESTED_AGREED",
    "QUOTED",
    "DECLINED",
    "SUPERSEDED",
    "COUNTER_PENDING",
  ],
  SUPPLIER_CONFIRMED: ["DECLINED", "SUPERSEDED", "COUNTER_PENDING", "QUOTED"],
  STAFF_ATTESTED_AGREED: ["DECLINED", "SUPERSEDED", "COUNTER_PENDING", "QUOTED"],
  DECLINED: ["QUOTED", "STAFF_RECORDED_UNCONFIRMED", "COUNTER_PENDING"],
  SUPERSEDED: [],
};

export function assertAllowedTransition(
  from: PriceAgreementStatus,
  to: PriceAgreementStatus,
): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid price agreement transition ${from} → ${to}`);
  }
}

export function canTransition(
  from: PriceAgreementStatus,
  to: PriceAgreementStatus,
): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
