# Supplier self-registration (Stage 4C)

## Purpose

Authenticated Auth0 users **without** an internal `User` / `ExternalIdentity` mapping can register a new supplier company. New companies start in `PENDING_REVIEW` and cannot access protected supplier data until an ADMIN activates them.

Invitation-based onboarding (Stage 4B) remains available for adding users to an **existing** supplier company.

## Applicant flow

1. Sign in with Auth0 (verified email required)
2. From `/access-pending` or home → **Register as supplier** → `/register/supplier`
3. Submit company name, contact details, brands / All Brands
4. Server creates in one transaction:
   - `Supplier` (`PENDING_REVIEW`, `registrationSource = SELF`)
   - `User` (`role = SUPPLIER` only)
   - `ExternalIdentity` (exact Auth0 issuer + `sub`)
5. Status page: `/register/supplier/status`
6. `/supplier/*` shows a locked pending/rejected message until `ACTIVE`

## Admin review

- `/admin/suppliers` → **Pending supplier registrations**
- Approve → `ACTIVE` + in-app `Notification` to applicant
- Reject → `REJECTED` with required reason + notification (distinct from `INACTIVE` deactivation)
- Detail page also shows a registration review panel for self-registered suppliers

## Security rules

- Never trust client `role`, `companyId`, `supplierId`, or `status`
- `companyId` comes from the single purchasing company helper
- Existing ADMIN / STAFF / SUPPLIER identities cannot self-register another company
- Duplicate Auth0 identity, email, or practical duplicate company names are blocked
- `requireSupplier()` still requires `Supplier.status === ACTIVE`

## Schema

Migration: `prisma/migrations/20261112040000_supplier_self_registration/`

- `SupplierStatus.REJECTED`
- `SupplierRegistrationSource` (`ADMIN` | `SELF`)
- `rejectionReason`, `reviewedAt`, `reviewedByUserId`

Applied on Neon project `holy-art-38015209` branch **development** (`br-morning-glade-b3odmb6e`) after approval. **Not** applied to production.

## Manual E2E (development)

1. Apply migration on development after approval
2. Sign in with an Auth0 user that is **not** linked yet; verify email
3. Register a throwaway company name (no real supplier data)
4. Confirm `/supplier/profile` stays locked / status pending
5. As ADMIN, approve from `/admin/suppliers` → applicant can open profile
6. Repeat with a second identity and **reject** with a reason → applicant sees rejected state
7. Confirm invitation flow still works for an existing ACTIVE supplier
