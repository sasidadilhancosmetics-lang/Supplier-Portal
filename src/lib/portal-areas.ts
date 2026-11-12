export type PortalArea = {
  href: "/admin" | "/staff" | "/supplier";
  title: string;
  audience: string;
  summary: string;
  purpose: string;
};

export const portalAreas: readonly PortalArea[] = [
  {
    href: "/admin",
    title: "Admin",
    audience: "Company Admin",
    summary: "Reserved for supplier setup and the admin overview.",
    purpose:
      "Company admins manage suppliers, brands membership, and activation. Access requires a provisioned ADMIN user.",
  },
  {
    href: "/staff",
    title: "Staff",
    audience: "Company Staff",
    summary:
      "Products, requirements, and supplier request review for company staff.",
    purpose:
      "Company staff manage provisional products, draft/confirm requirements, distribute requests, and review availability. Access requires ADMIN or STAFF; actions use StaffPermission grants (ADMIN bypasses).",
  },
  {
    href: "/supplier",
    title: "Supplier",
    audience: "Supplier",
    summary: "Request responses and company profile for suppliers.",
    purpose:
      "Suppliers answer availability requests and maintain their company profile. Orders and deliveries come later. Access requires a provisioned SUPPLIER user with supplierId.",
  },
];

export function getPortalArea(href: PortalArea["href"]): PortalArea {
  const area = portalAreas.find((item) => item.href === href);

  if (!area) {
    throw new Error(`Missing portal area: ${href}`);
  }

  return area;
}
