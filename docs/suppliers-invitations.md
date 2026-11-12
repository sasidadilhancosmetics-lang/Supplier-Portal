# Supplier invitations and Auth0 linking (Stage 4B)

## Model

`SupplierInvitation` stores:

- `supplierId` / `companyId` (trusted server context)
- normalized `invitedEmail` (destination only — not identity proof)
- `role` fixed to `SUPPLIER` in application code
- `tokenHash` (SHA-256 of a 32-byte random token)
- `status`: `PENDING` | `ACCEPTED` | `REVOKED`
- `expiresAt` (72 hours)

Plaintext tokens are never stored. Ordinary Auth0 login still does **not** auto-create supplier users.

## Admin flow

1. Open `/admin/suppliers/[id]` → **Users**
2. Enter invite email → **Create invitation**
3. With no email provider configured, the UI shows a **one-time** accept URL for development copy/paste
4. Revoke pending invites or disable linked users as needed

## Accept flow

1. Open `/invite/accept?token=…`
2. Unauthenticated users are sent to `/auth/login?returnTo=/invite/accept?token=…` (returnTo allowlisted)
3. Authenticated user must have:
   - Auth0 `email_verified === true`
   - email matching the invitation (normalized)
4. Acceptance transaction:
   - claims the pending invite (`updateMany` status PENDING)
   - creates/reuses the SUPPLIER `User` for that supplier
   - creates `ExternalIdentity` with exact Auth0 issuer + `sub`
   - never links by email alone

## Supplier profile

- `/supplier/profile` — edit own company profile/brands
- `supplierId` from authenticated `User`
- Cannot change status / company ownership
- Active-request brand rules still apply
- Disabled users and inactive suppliers remain blocked by `requireSupplier()`

## Manual E2E (development)

1. Apply migration `20261111183000_supplier_invitation` on Neon **development** after approval
2. As ADMIN, invite a verified Auth0 email for an ACTIVE supplier
3. Copy the one-time accept URL (do not commit or paste tokens into source control)
4. Open URL in a private window → Auth0 login with the invited email → accept
5. Confirm `/supplier/profile` loads and `/admin` does not
6. Replay the same token → already-accepted / safe failure
7. Expired/revoked tokens fail closed
8. Disable the user → subsequent access returns to pending/denied

## Schema migration

Migration prepared at `prisma/migrations/20261111183000_supplier_invitation/`.

Applied on Neon project `holy-art-38015209` branch **development** (`br-morning-glade-b3odmb6e`) after approval. **Not** applied to production.
