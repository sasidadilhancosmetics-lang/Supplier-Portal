# Authorization (Stage 3B)

Server-side authorization for Supplier Portal. UI navigation and `src/proxy.ts` are not sufficient.

## Identity

1. Auth0 session proves login only.
2. `ExternalIdentity` maps `(provider, providerIssuer, providerSubject)` → internal `User.id`.
3. Role and `supplierId` come from the `User` row. Client input and Auth0 claims are never trusted for authorization.

## Helpers

| Helper | Purpose |
| --- | --- |
| `requireAuthenticatedUser()` | Active provisioned internal user (throws `UNAUTHENTICATED` / `FORBIDDEN`) |
| `requireAdmin()` | `User.role === ADMIN` |
| `requireStaffPermission(code)` | STAFF must have a `StaffPermission` row; **ADMIN bypasses by default** |
| `requireSupplier()` | `SUPPLIER` + `User.supplierId` + `Supplier.status === ACTIVE` |
| `requireSupplierOwnership(resourceSupplierId)` | Resource must match the caller's DB `supplierId`; mismatch → **404** |
| `requireCanManageStaffPermissions()` | ADMIN only — STAFF cannot self-elevate |
| `requireSupplierQueryScope()` | Returns `{ user, where: { supplierId } }` for Prisma filters |

Page wrappers (`*Page`) map errors to `/auth/login`, `/access-pending`, `/`, or `notFound()`.

API/server-action handlers should catch `AuthorizationError` and use `authorizationErrorResponse()` → `{ error }` with status **401 / 403 / 404** without supplier details.

Policy primitives live in `src/lib/auth/authorize.ts` (unit-tested). DB-backed guards live in `src/lib/auth/guards.ts`.

## Staff permissions

- Catalog: `StaffPermissionCode` (provisional enum in Prisma).
- Grants: `StaffPermission` rows only. Deny by default.
- `requireStaffPermission("MANAGE_SUPPLIERS")` etc. for actions — not only route entry.
- `/staff` area allows ADMIN or STAFF; individual actions still need permission checks (or ADMIN bypass).
- Only ADMIN may create/delete `StaffPermission` grants (`assertCanManageStaffPermissions`).

## Supplier isolation

- Always derive `supplierId` from the authenticated `User`.
- Apply `supplierScopeWhere(user)` / `requireSupplierQueryScope()` on supplier-owned queries.
- Cross-supplier access returns **NOT_FOUND (404)**, not a detailed 403, to avoid existence leaks.
- `PENDING_REVIEW` and `INACTIVE` suppliers cannot access protected supplier data (**403**).
- Inactive users (`User.isActive = false`) are treated as pending/unauthenticated for protected routes.

## Schema changes for Stage 3B

**None required.** Existing models are sufficient:

- `User.role`, `User.supplierId`, `User.isActive`
- `ExternalIdentity`
- `StaffPermission` + `StaffPermissionCode`
- `Supplier.status`

No migration is requested for Stage 3B.

## Tests

```bash
npm test
```

`src/lib/auth/authorize.test.ts` covers ADMIN / STAFF / SUPPLIER policy, deny-by-default permissions, ADMIN bypass, cross-supplier NOT_FOUND, inactive/pending suppliers, and staff self-elevation denial.

Manual: signed-in development ADMIN can still open `/admin`; `/staff` and `/supplier` remain role-gated.

## Supplier invitations (Stage 4B)

Invite acceptance and account linking rules: [suppliers-invitations.md](suppliers-invitations.md). Linking always uses `ExternalIdentity` (issuer + subject); email is invitation destination and verification match only.
