# Auth0 setup (Stage 3A)

Auth foundation uses `@auth0/nextjs-auth0` v4 with Next.js 16 `src/proxy.ts`.

## Application identity model

- **Internal id:** `User.id` (cuid) is the permanent application identity.
- **External mapping:** `ExternalIdentity` stores `provider` + `providerIssuer` + `providerSubject` (Auth0 `sub`).
- Auth0 `sub` is never used as `User.id`, supplier id, or another business key.
- Unknown Auth0 logins are **not** auto-provisioned as ADMIN/STAFF/SUPPLIER.
- Matching email alone never links an Auth0 identity to an existing `User`.
- Roles and `supplierId` are read from Postgres after a provisioned mapping exists.

## Create the Auth0 application (development)

In the Auth0 Dashboard (personal development tenant for now):

1. **Applications → Create Application**
2. Name: `Supplier Portal` (development)
3. Type: **Regular Web Application**
4. Technology: Next.js (optional)

### Allowed URLs (local)

| Setting | Value |
| --- | --- |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| Allowed Web Origins | `http://localhost:3000` |

Add production host URLs later when deploying; do not reuse development secrets in production.

### Environment variables

Copy `.env.example` → `.env.local` and set:

- `AUTH0_DOMAIN` — tenant domain (e.g. `your-tenant.us.auth0.com`)
- `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` — from the Auth0 application
- `AUTH0_SECRET` — `openssl rand -hex 32`
- `APP_BASE_URL` — `http://localhost:3000` locally

Never commit real values. Never print secrets in logs or docs.

## SDK routes

Handled by Auth0 middleware via `src/proxy.ts`:

- `/auth/login`
- `/auth/logout`
- `/auth/callback`
- `/auth/profile` (SDK-provided; not used for authorization)

## Provisioning a user (manual / SQL for now)

1. Ensure a `Company` row exists.
2. Create a `User` with the correct `role` and optional `supplierId` (required for `SUPPLIER`).
3. After the person signs in once (or using their Auth0 `sub` from the dashboard), insert `ExternalIdentity`:

```sql
INSERT INTO "ExternalIdentity" (
  "id", "userId", "provider", "providerIssuer", "providerSubject",
  "createdAt", "updatedAt"
) VALUES (
  /* cuid */, /* User.id */, 'auth0',
  'https://YOUR_TENANT.auth0.com/',
  'auth0|…',
  NOW(), NOW()
);
```

Issuer must match the ID token `iss` (usually `https://{AUTH0_DOMAIN}/`).

## Route protection

| Area | Server guard |
| --- | --- |
| `/admin/*` | `requireAdminPage()` |
| `/staff/*` | `requireStaffAreaPage()` (ADMIN or STAFF; actions use `requireStaffPermission`) |
| `/supplier/*` | `requireSupplierPage()` (ACTIVE supplier only) |
| `/access-pending` | Auth0 session required; provisioned users redirected home |

Middleware/proxy alone is not authorization. Prefer `src/lib/auth/guards.ts` in Server Components / route handlers. See [authorization.md](authorization.md) for Stage 3B details.

## Future company-owned Auth0 tenant

Store `providerIssuer` per mapping so a later company tenant can add a second `ExternalIdentity` row for the same `User.id` without changing business keys.
