import type {
  StaffPermissionCode,
  SupplierStatus,
} from "@/generated/prisma/client";

import { AuthorizationError } from "./errors";
import type { ProvisionedAppUser } from "./types";

/** Active internal user required for any protected data access. */
export function assertAuthenticatedUser(
  user: ProvisionedAppUser | null | undefined,
): asserts user is ProvisionedAppUser {
  if (!user || !user.isActive) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }
}

export function assertAdmin(user: ProvisionedAppUser): void {
  assertAuthenticatedUser(user);
  if (user.role !== "ADMIN") {
    throw new AuthorizationError("FORBIDDEN");
  }
}

/**
 * Staff permission check. Deny by default.
 * ADMIN bypasses staff permission grants when `adminBypass` is true (default).
 * Permissions must come from StaffPermission rows — never from client input.
 */
export function assertStaffPermission(
  user: ProvisionedAppUser,
  granted: ReadonlySet<StaffPermissionCode>,
  permission: StaffPermissionCode,
  options: { adminBypass?: boolean } = {},
): void {
  assertAuthenticatedUser(user);

  const adminBypass = options.adminBypass ?? true;
  if (adminBypass && user.role === "ADMIN") {
    return;
  }

  if (user.role !== "STAFF") {
    throw new AuthorizationError("FORBIDDEN");
  }

  if (!granted.has(permission)) {
    throw new AuthorizationError("FORBIDDEN");
  }
}

export function assertSupplierUser(user: ProvisionedAppUser): void {
  assertAuthenticatedUser(user);

  if (user.role !== "SUPPLIER" || !user.supplierId) {
    throw new AuthorizationError("FORBIDDEN");
  }
}

/**
 * Supplier account must be ACTIVE. Pending/inactive suppliers cannot access
 * protected supplier data. Does not reveal other suppliers' existence.
 */
export function assertSupplierAccountActive(status: SupplierStatus): void {
  if (status !== "ACTIVE") {
    throw new AuthorizationError("FORBIDDEN");
  }
}

/**
 * Ownership check. Mismatch returns NOT_FOUND so callers do not leak whether
 * another supplier's resource exists.
 */
export function assertSupplierOwnership(
  user: ProvisionedAppUser,
  resourceSupplierId: string,
): void {
  assertSupplierUser(user);

  if (!resourceSupplierId || user.supplierId !== resourceSupplierId) {
    throw new AuthorizationError("NOT_FOUND");
  }
}

/**
 * Only ADMIN may grant/revoke StaffPermission rows.
 * STAFF users cannot elevate themselves or peers.
 */
export function assertCanManageStaffPermissions(user: ProvisionedAppUser): void {
  assertAdmin(user);
}

/** Prisma `where` fragment for supplier-owned queries. Never use client input. */
export function supplierScopeWhere(user: ProvisionedAppUser): {
  supplierId: string;
} {
  assertSupplierUser(user);
  return { supplierId: user.supplierId! };
}
