/** Pure UI helpers for supplier request list cards. */

export type SupplierRequestListAction = {
  label: string;
  href: string;
};

export function supplierRequestListAction(args: {
  id: string;
  status: string;
  hasPendingCounter?: boolean;
}): SupplierRequestListAction {
  const base = args.hasPendingCounter
    ? `/supplier/requests/${args.id}?focus=counter`
    : `/supplier/requests/${args.id}`;

  if (args.hasPendingCounter) {
    return { label: "Respond", href: base };
  }

  switch (args.status) {
    case "NEW":
      return { label: "Respond", href: base };
    case "PARTIALLY_RESPONDED":
      return { label: "Continue", href: base };
    case "RESPONDED":
    case "CLOSED":
      return { label: "View Response", href: base };
    default:
      return { label: "View Response", href: base };
  }
}
