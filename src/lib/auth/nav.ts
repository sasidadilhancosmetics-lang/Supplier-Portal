import type { AuthState } from "@/lib/auth/types";
import { portalAreas, type PortalArea } from "@/lib/portal-areas";

/** Role-appropriate nav links. Unknown/pending users only see Home. */
export function navAreasForAuth(auth: AuthState): readonly PortalArea[] {
  if (auth.status !== "provisioned") {
    return [];
  }

  switch (auth.user.role) {
    case "ADMIN":
      // Admin may enter the staff area; action-level checks still apply.
      return portalAreas.filter(
        (area) => area.href === "/admin" || area.href === "/staff",
      );
    case "STAFF":
      return portalAreas.filter((area) => area.href === "/staff");
    case "SUPPLIER":
      return portalAreas.filter((area) => area.href === "/supplier");
    default:
      return [];
  }
}
