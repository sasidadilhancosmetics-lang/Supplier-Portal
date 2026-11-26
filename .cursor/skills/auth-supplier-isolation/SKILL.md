---
name: auth-supplier-isolation
description: >-
  Auth0 authorization and supplier isolation for Supplier Portal. Use when
  changing guards, staff permissions, ADMIN bypass, supplier ownership, session
  resolution, or any cross-tenant query/mutation. Enforce deny-by-default and
  session-derived supplier/company scope in application code.
---

# Auth and supplier isolation

## Canonical docs

- [docs/authorization.md](../../../docs/authorization.md)
- [docs/auth0-setup.md](../../../docs/auth0-setup.md)
- [docs/suppliers-admin.md](../../../docs/suppliers-admin.md)
- [docs/suppliers-invitations.md](../../../docs/suppliers-invitations.md)
- [docs/suppliers-self-registration.md](../../../docs/suppliers-self-registration.md)
- [docs/decisions.md](../../../docs/decisions.md)

## Hard rules

1. Resolve identity via Auth0 session → `ExternalIdentity` → internal `User` (no email-only linking for authz).
2. **Never trust** client-supplied `supplierId`, `companyId`, or permission claims.
3. Scope all supplier business reads/writes with **session** `supplierId` + `companyId`.
4. Cross-supplier access → **`NOT_FOUND`** (do not leak existence).
5. Inactive / non-ACTIVE suppliers: block business mutations (confirm, cancel, availability submit as required by stage rules).
6. STAFF permissions come from `StaffPermission` rows; **ADMIN bypass** only where documented (default for `requireStaffPermission`).
7. Keep authorization checks in **application code** (guards/services), not only UI hiding.
8. Align list/filter helpers with the same ACL as the primary loader (avoid `Promise.all` of mismatched permission gates).

## Mutation authz checklist

When touching confirm/cancel/allocate/distribute/availability:

- Call the correct guard (`requireSupplier`, `requireStaffPermission`, ownership helpers).
- Add/extend **authz unit tests** for allow, deny, and cross-supplier isolation.
- Ensure unauthorized paths cannot write audit or notifications.

## Related skills

- Domain rules → `supplier-portal-architecture`
- DB safety → `prisma-neon-safety`
- Tests → `feature-dev-qa`
