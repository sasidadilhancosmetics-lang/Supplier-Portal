import "server-only";

import { isAuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import type { ProvisionedAppUser } from "@/lib/auth/types";

/**
 * List/view requirements: MANAGE_REQUIREMENTS, CONFIRM_REQUIREMENT, or
 * SEND_SUPPLIER_REQUEST (ADMIN bypasses). Non-auth errors are not swallowed.
 */
export async function requireRequirementReadAccess(): Promise<ProvisionedAppUser> {
  try {
    return await requireStaffPermission("MANAGE_REQUIREMENTS");
  } catch (error) {
    if (!isAuthorizationError(error)) throw error;
    try {
      return await requireStaffPermission("CONFIRM_REQUIREMENT");
    } catch (error2) {
      if (!isAuthorizationError(error2)) throw error2;
      return requireStaffPermission("SEND_SUPPLIER_REQUEST");
    }
  }
}
