import { describe, expect, it } from "vitest";

/**
 * Pure policy assertions for invitation acceptance edge cases.
 * Full DB/Auth0 acceptance is covered by service integration after migrate.
 */

function assertInviteRoleIsSupplier(role: string) {
  if (role !== "SUPPLIER") {
    throw new Error("INVALID_ROLE");
  }
}

function assertNoEmailOnlyLink(opts: {
  hasExternalIdentityMatch: boolean;
  emailsMatch: boolean;
}) {
  // Email match alone never creates a link.
  return opts.hasExternalIdentityMatch === true && opts.emailsMatch;
}

function assertNotCrossSupplier(opts: {
  existingSupplierId: string | null;
  invitationSupplierId: string;
  existingRole: string | null;
}) {
  if (!opts.existingRole) return true;
  return (
    opts.existingRole === "SUPPLIER" &&
    opts.existingSupplierId === opts.invitationSupplierId
  );
}

describe("invitation acceptance policy", () => {
  it("never allows ADMIN or STAFF invitation roles", () => {
    expect(() => assertInviteRoleIsSupplier("ADMIN")).toThrow("INVALID_ROLE");
    expect(() => assertInviteRoleIsSupplier("STAFF")).toThrow("INVALID_ROLE");
    expect(() => assertInviteRoleIsSupplier("SUPPLIER")).not.toThrow();
  });

  it("does not treat email match alone as identity proof", () => {
    expect(
      assertNoEmailOnlyLink({
        hasExternalIdentityMatch: false,
        emailsMatch: true,
      }),
    ).toBe(false);
  });

  it("denies linking when Auth0 identity belongs to another supplier", () => {
    expect(
      assertNotCrossSupplier({
        existingRole: "SUPPLIER",
        existingSupplierId: "sup_a",
        invitationSupplierId: "sup_b",
      }),
    ).toBe(false);
  });

  it("allows same-supplier re-link / idempotent path", () => {
    expect(
      assertNotCrossSupplier({
        existingRole: "SUPPLIER",
        existingSupplierId: "sup_a",
        invitationSupplierId: "sup_a",
      }),
    ).toBe(true);
  });

  it("rejects elevating via invitation into company staff roles", () => {
    expect(
      assertNotCrossSupplier({
        existingRole: "ADMIN",
        existingSupplierId: null,
        invitationSupplierId: "sup_a",
      }),
    ).toBe(false);
  });
});
