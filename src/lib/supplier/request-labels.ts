/** Supplier-facing labels — never show raw enums in UI. */

export function isAgreedPriceAgreementStatus(
  status: string | null | undefined,
): boolean {
  return status === "SUPPLIER_CONFIRMED" || status === "STAFF_ATTESTED_AGREED";
}

/**
 * Unit price shown in the availability editor.
 * Never prefills an unaccepted company counter.
 */
export function editableUnitPriceDefault(offer: {
  status: string;
  unitPrice?: string | null;
  supplierQuotedUnitPrice?: string | null;
  priceAgreement?: { status: string; unitPrice: string } | null;
} | null): string {
  if (!offer || offer.status === "NOT_AVAILABLE") return "";
  if (isAgreedPriceAgreementStatus(offer.priceAgreement?.status)) {
    return offer.priceAgreement?.unitPrice ?? "";
  }
  if (offer.priceAgreement?.status === "COUNTER_PENDING") {
    return offer.supplierQuotedUnitPrice ?? "";
  }
  return offer.supplierQuotedUnitPrice ?? offer.unitPrice ?? "";
}

export function supplierRequestStatusLabel(status: string): string {
  switch (status) {
    case "NEW":
      return "Need Reply";
    case "PARTIALLY_RESPONDED":
      return "Partly Answered";
    case "RESPONDED":
      return "Response Sent";
    case "CLOSED":
      return "Closed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function supplierOfferStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "SUBMITTED":
      return "Submitted";
    case "NOT_AVAILABLE":
      return "Not available";
    case "EXPIRED":
      return "Reserve expired";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

/** Item still needs an availability answer from the supplier. */
export function itemNeedsAvailabilityAnswer(item: {
  offer: { status: string } | null;
}): boolean {
  if (!item.offer) return true;
  return (
    item.offer.status === "DRAFT" ||
    item.offer.status === "EXPIRED" ||
    item.offer.status === "CANCELLED"
  );
}

/**
 * Collapse the full availability editor when every line already has a
 * submitted (or not-available) answer. Unanswered lines force the form open.
 */
export function shouldCollapseAvailabilityEditor(
  items: Array<{ offer: { status: string } | null }>,
): boolean {
  if (items.length === 0) return false;
  return items.every((item) => !itemNeedsAvailabilityAnswer(item));
}
