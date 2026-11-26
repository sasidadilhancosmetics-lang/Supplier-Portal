import { describe, expect, it } from "vitest";

import type { StaffPermissionCode } from "@/generated/prisma/client";

import {
  assertAdmin,
  assertAuthenticatedUser,
  assertCanManageStaffPermissions,
  assertStaffPermission,
  assertStaffPermissions,
  assertSupplierAccountActive,
  assertSupplierOwnership,
  assertSupplierUser,
  supplierScopeWhere,
} from "./authorize";
import { AuthorizationError } from "./errors";
import type { ProvisionedAppUser } from "./types";

function user(
  overrides: Partial<ProvisionedAppUser> & Pick<ProvisionedAppUser, "role">,
): ProvisionedAppUser {
  return {
    id: "user_1",
    email: "user@example.com",
    name: "User",
    companyId: "co_1",
    supplierId: null,
    isActive: true,
    ...overrides,
  };
}

describe("assertAuthenticatedUser", () => {
  it("accepts an active provisioned user", () => {
    expect(() => assertAuthenticatedUser(user({ role: "ADMIN" }))).not.toThrow();
  });

  it("rejects missing or inactive users as unauthenticated", () => {
    expect(() => assertAuthenticatedUser(null)).toThrow(AuthorizationError);
    try {
      assertAuthenticatedUser(user({ role: "STAFF", isActive: false }));
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    }
  });
});

describe("assertAdmin", () => {
  it("allows ADMIN only", () => {
    expect(() => assertAdmin(user({ role: "ADMIN" }))).not.toThrow();
    expect(() => assertAdmin(user({ role: "STAFF" }))).toThrow(
      AuthorizationError,
    );
    expect(() =>
      assertAdmin(user({ role: "SUPPLIER", supplierId: "sup_1" })),
    ).toThrow(AuthorizationError);
  });
});

describe("assertStaffPermission", () => {
  const manageSuppliers: StaffPermissionCode = "MANAGE_SUPPLIERS";

  it("denies by default when the staff user has no grants", () => {
    expect(() =>
      assertStaffPermission(
        user({ role: "STAFF" }),
        new Set(),
        manageSuppliers,
      ),
    ).toThrow(AuthorizationError);
  });

  it("allows STAFF when the permission is granted", () => {
    expect(() =>
      assertStaffPermission(
        user({ role: "STAFF" }),
        new Set<StaffPermissionCode>([manageSuppliers]),
        manageSuppliers,
      ),
    ).not.toThrow();
  });

  it("allows ADMIN to bypass staff permission checks by default", () => {
    expect(() =>
      assertStaffPermission(
        user({ role: "ADMIN" }),
        new Set(),
        manageSuppliers,
      ),
    ).not.toThrow();
  });

  it("can disable ADMIN bypass when explicitly requested", () => {
    expect(() =>
      assertStaffPermission(
        user({ role: "ADMIN" }),
        new Set(),
        manageSuppliers,
        { adminBypass: false },
      ),
    ).toThrow(AuthorizationError);
  });

  it("never trusts SUPPLIER role for staff permissions", () => {
    expect(() =>
      assertStaffPermission(
        user({ role: "SUPPLIER", supplierId: "sup_1" }),
        new Set<StaffPermissionCode>([manageSuppliers]),
        manageSuppliers,
      ),
    ).toThrow(AuthorizationError);
  });
});

describe("assertStaffPermissions (AND)", () => {
  it("requires every listed permission for STAFF", () => {
    expect(() =>
      assertStaffPermissions(
        user({ role: "STAFF" }),
        new Set<StaffPermissionCode>(["VERIFY_DELIVERY"]),
        ["VERIFY_DELIVERY", "ISSUE_GRN"],
      ),
    ).toThrow(AuthorizationError);

    expect(() =>
      assertStaffPermissions(
        user({ role: "STAFF" }),
        new Set<StaffPermissionCode>(["ISSUE_GRN"]),
        ["VERIFY_DELIVERY", "ISSUE_GRN"],
      ),
    ).toThrow(AuthorizationError);

    expect(() =>
      assertStaffPermissions(
        user({ role: "STAFF" }),
        new Set<StaffPermissionCode>(["VERIFY_DELIVERY", "ISSUE_GRN"]),
        ["VERIFY_DELIVERY", "ISSUE_GRN"],
      ),
    ).not.toThrow();
  });

  it("allows ADMIN to bypass both permissions", () => {
    expect(() =>
      assertStaffPermissions(
        user({ role: "ADMIN" }),
        new Set(),
        ["VERIFY_DELIVERY", "ISSUE_GRN"],
      ),
    ).not.toThrow();
  });
});

describe("supplier isolation", () => {
  it("requires SUPPLIER role and supplierId", () => {
    expect(() => assertSupplierUser(user({ role: "ADMIN" }))).toThrow(
      AuthorizationError,
    );
    expect(() => assertSupplierUser(user({ role: "SUPPLIER" }))).toThrow(
      AuthorizationError,
    );
    expect(() =>
      assertSupplierUser(user({ role: "SUPPLIER", supplierId: "sup_1" })),
    ).not.toThrow();
  });

  it("blocks pending, inactive, and rejected supplier accounts", () => {
    expect(() => assertSupplierAccountActive("ACTIVE")).not.toThrow();
    expect(() => assertSupplierAccountActive("PENDING_REVIEW")).toThrow(
      AuthorizationError,
    );
    expect(() => assertSupplierAccountActive("INACTIVE")).toThrow(
      AuthorizationError,
    );
    expect(() => assertSupplierAccountActive("REJECTED")).toThrow(
      AuthorizationError,
    );
  });

  it("returns NOT_FOUND for cross-supplier access (no leak)", () => {
    try {
      assertSupplierOwnership(
        user({ role: "SUPPLIER", supplierId: "sup_1" }),
        "sup_other",
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
  });

  it("allows matching ownership and builds a server-side where clause", () => {
    const supplier = user({ role: "SUPPLIER", supplierId: "sup_1" });
    expect(() => assertSupplierOwnership(supplier, "sup_1")).not.toThrow();
    expect(supplierScopeWhere(supplier)).toEqual({ supplierId: "sup_1" });
  });
});

describe("staff permission elevation", () => {
  it("allows only ADMIN to manage StaffPermission grants", () => {
    expect(() =>
      assertCanManageStaffPermissions(user({ role: "ADMIN" })),
    ).not.toThrow();
    expect(() =>
      assertCanManageStaffPermissions(user({ role: "STAFF" })),
    ).toThrow(AuthorizationError);
    expect(() =>
      assertCanManageStaffPermissions(
        user({ role: "SUPPLIER", supplierId: "sup_1" }),
      ),
    ).toThrow(AuthorizationError);
  });
});

describe("unknown / missing identity posture", () => {
  it("treats absent users as unauthenticated rather than inventing roles", () => {
    try {
      assertAuthenticatedUser(undefined);
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    }
  });
});
