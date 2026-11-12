import "server-only";

import { notFound, redirect } from "next/navigation";

import type { StaffPermissionCode } from "@/generated/prisma/client";

import {
  assertAdmin,
  assertAuthenticatedUser,
  assertCanManageStaffPermissions,
  assertStaffPermission,
  assertSupplierAccountActive,
  assertSupplierOwnership,
  assertSupplierUser,
  supplierScopeWhere,
} from "@/lib/auth/authorize";
import { AuthorizationError, isAuthorizationError } from "@/lib/auth/errors";
import { loadStaffPermissionCodes } from "@/lib/auth/permissions";
import { getAuthState } from "@/lib/auth/session";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

function handlePageAuthError(error: unknown): never {
  if (!isAuthorizationError(error)) {
    throw error;
  }

  if (error.code === "UNAUTHENTICATED") {
    redirect("/auth/login");
  }

  if (error.code === "NOT_FOUND") {
    notFound();
  }

  redirect("/");
}

/**
 * Resolve the provisioned internal user or throw AuthorizationError.
 * Inactive users are treated as unauthenticated for protected access.
 */
export async function requireAuthenticatedUser(): Promise<ProvisionedAppUser> {
  const state = await getAuthState();

  if (state.status === "anonymous") {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  if (state.status === "pending") {
    // Known Auth0 identity without an active internal mapping.
    throw new AuthorizationError("FORBIDDEN");
  }

  assertAuthenticatedUser(state.user);
  return state.user;
}

export async function requireAdmin(): Promise<ProvisionedAppUser> {
  const user = await requireAuthenticatedUser();
  assertAdmin(user);
  return user;
}

/**
 * STAFF must hold the given StaffPermission row. ADMIN bypasses by default.
 * Deny by default for any other role or missing grant.
 */
export async function requireStaffPermission(
  permission: StaffPermissionCode,
  options: { adminBypass?: boolean } = {},
): Promise<ProvisionedAppUser> {
  const user = await requireAuthenticatedUser();
  const granted = await loadStaffPermissionCodes(user.id);
  assertStaffPermission(user, granted, permission, options);
  return user;
}

/**
 * SUPPLIER role with supplierId from the internal User row (any supplier status).
 * Does not require ACTIVE — used for registration status UX.
 */
export async function requireSupplierIdentity(): Promise<ProvisionedAppUser> {
  const user = await requireAuthenticatedUser();
  assertSupplierUser(user);
  return user;
}

/**
 * SUPPLIER role with supplierId from the internal User row, and an ACTIVE
 * Supplier account. Pending/inactive/rejected suppliers are forbidden.
 */
export async function requireSupplier(): Promise<ProvisionedAppUser> {
  const user = await requireSupplierIdentity();

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: user.supplierId!,
      companyId: user.companyId,
    },
    select: { id: true, status: true },
  });

  if (!supplier) {
    // Do not reveal whether the supplier id was wrong vs missing.
    throw new AuthorizationError("FORBIDDEN");
  }

  assertSupplierAccountActive(supplier.status);
  return user;
}

/**
 * Ensures the resource belongs to the caller's supplierId (from DB, not client).
 * Cross-supplier access → NOT_FOUND (no existence leak).
 */
export async function requireSupplierOwnership(
  resourceSupplierId: string,
): Promise<ProvisionedAppUser> {
  const user = await requireSupplier();
  assertSupplierOwnership(user, resourceSupplierId);
  return user;
}

/** ADMIN-only: grant/revoke StaffPermission. STAFF cannot self-elevate. */
export async function requireCanManageStaffPermissions(): Promise<ProvisionedAppUser> {
  const user = await requireAuthenticatedUser();
  assertCanManageStaffPermissions(user);
  return user;
}

/** Convenience for supplier-owned Prisma queries. */
export async function requireSupplierQueryScope(): Promise<{
  user: ProvisionedAppUser;
  where: { supplierId: string };
}> {
  const user = await requireSupplier();
  return { user, where: supplierScopeWhere(user) };
}

// ---------------------------------------------------------------------------
// Page-oriented wrappers (redirect / notFound instead of throwing to clients)
// ---------------------------------------------------------------------------

export async function requireAuthenticatedUserPage(): Promise<ProvisionedAppUser> {
  try {
    return await requireAuthenticatedUser();
  } catch (error) {
    if (isAuthorizationError(error) && error.code === "FORBIDDEN") {
      redirect("/access-pending");
    }
    handlePageAuthError(error);
  }
}

export async function requireAdminPage(): Promise<ProvisionedAppUser> {
  try {
    return await requireAdmin();
  } catch (error) {
    handlePageAuthError(error);
  }
}

export async function requireStaffAreaPage(): Promise<ProvisionedAppUser> {
  try {
    const user = await requireAuthenticatedUser();
    if (user.role === "ADMIN" || user.role === "STAFF") {
      return user;
    }
    throw new AuthorizationError("FORBIDDEN");
  } catch (error) {
    handlePageAuthError(error);
  }
}

export async function requireSupplierPage(): Promise<ProvisionedAppUser> {
  try {
    return await requireSupplier();
  } catch (error) {
    handlePageAuthError(error);
  }
}

export async function requireSupplierIdentityPage(): Promise<ProvisionedAppUser> {
  try {
    return await requireSupplierIdentity();
  } catch (error) {
    handlePageAuthError(error);
  }
}

export async function requireSupplierOwnershipPage(
  resourceSupplierId: string,
): Promise<ProvisionedAppUser> {
  try {
    return await requireSupplierOwnership(resourceSupplierId);
  } catch (error) {
    handlePageAuthError(error);
  }
}

/** @deprecated Prefer requireAdminPage / requireStaffAreaPage / requireSupplierPage */
export async function requireRole(
  ...roles: Array<"ADMIN" | "STAFF" | "SUPPLIER">
): Promise<ProvisionedAppUser> {
  try {
    const user = await requireAuthenticatedUser();
    if (!roles.includes(user.role)) {
      throw new AuthorizationError("FORBIDDEN");
    }
    if (user.role === "SUPPLIER") {
      return requireSupplier();
    }
    return user;
  } catch (error) {
    if (isAuthorizationError(error) && error.code === "FORBIDDEN") {
      const state = await getAuthState();
      if (state.status === "pending") {
        redirect("/access-pending");
      }
    }
    handlePageAuthError(error);
  }
}

/** @deprecated Prefer requireSupplierOwnership */
export async function requireSupplierScope(
  resourceSupplierId: string,
): Promise<ProvisionedAppUser> {
  return requireSupplierOwnershipPage(resourceSupplierId);
}

export async function requireAuth0Session(): Promise<void> {
  const state = await getAuthState();
  if (state.status === "anonymous") {
    redirect("/auth/login");
  }
}

export async function requireProvisionedUser(): Promise<ProvisionedAppUser> {
  return requireAuthenticatedUserPage();
}
