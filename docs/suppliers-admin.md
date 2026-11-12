# Admin supplier management (Stage 4A)

Admin-only supplier company CRUD for the purchasing company.

Self-registration review: [suppliers-self-registration.md](suppliers-self-registration.md) (Stage 4C).  
User invitations: [suppliers-invitations.md](suppliers-invitations.md) (Stage 4B).

## Routes

| Path | Purpose |
| --- | --- |
| `/admin` | Admin hub with links |
| `/admin/suppliers` | Search, status filter, pagination |
| `/admin/suppliers/new` | Create supplier |
| `/admin/suppliers/[id]` | View/edit profile, brands, activate/deactivate, invite/disable users |

Supplier user invitations and Auth0 linking: [suppliers-invitations.md](suppliers-invitations.md) (Stage 4B).

## Security

- Every list/get/mutation calls `requireAdmin()`.
- `companyId` always comes from the authenticated admin `User` row.
- Client-supplied `companyId` is ignored; `supplierId` is looked up under the admin’s company.
- Supplier + brand membership writes run in Prisma transactions.
- AuditLog rows: `CREATE`, `UPDATE`, `BRANDS_CHANGE`, `STATUS_CHANGE`.
- Errors returned to the UI are generic domain messages — no cross-tenant leakage.

## Brand rules

Active request statuses: `NEW`, `PARTIALLY_RESPONDED`, `RESPONDED`.

- Cannot remove a `SupplierBrand` while that brand has an active request.
- Cannot turn off `supportsAllBrands` while active requests exist for brands not still covered by remaining memberships.

Pure rule helpers: `src/lib/suppliers/brand-rules.ts` (unit tested).

## Schema

No migration for Stage 4A. Uses existing `Supplier`, `Brand`, `SupplierBrand`, `AuditLog`.

Duplicate supplier names are blocked per company in application code (case-insensitive).

## Tests

```bash
npm test
```

Includes brand-rule tests, Zod validation tests, and unauthorized mutation rejection when `requireAdmin` fails.
