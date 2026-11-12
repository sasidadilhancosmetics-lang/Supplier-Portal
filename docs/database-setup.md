# Database setup (Stage 2B)

Prisma ORM 7 + Neon PostgreSQL. Schema: [database-design.md](database-design.md) / `prisma/schema.prisma`.

## Neon link

Project: `holy-art-38015209` (org `org-misty-glade-04808036`). Local link file: `.neon`.

`neon init` writes secrets into **`.env.local`** (gitignored):

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | Pooled — Prisma Client via `@prisma/adapter-neon` |
| `DATABASE_URL_UNPOOLED` | Direct — Prisma Migrate (`prisma.config.ts`) |
| `DIRECT_DATABASE_URL` | Optional alias for the unpooled URL |
| `NEON_BRANCH` / `NEON_BRANCH_ID` | Branch metadata |

Never commit `.env.local`. Never hardcode credentials.

**Important:** A process-level `DATABASE_URL` (for example a local Postgres URL in the shell or OS env) **shadows** `.env.local` in Next.js and many Node tools. For this app, clear it before `next dev` / `next start` if health checks fail against localhost:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

## Local commands

```bash
npm run db:validate
npm run db:generate
npm run db:migrate:status
npm run db:migrate:deploy   # only after explicit approval on an empty development DB
```

Health check (read-only): `GET /api/health/db` → `{ ok, database: "up"|"down" }` with no secrets or host details.

Server client: `src/lib/db.ts` (import `server-only`; do not use from Client Components).

## Migration policy

1. Prefer a **development** Neon branch — do not run first migrate against production without approval.
2. Confirm the target database is empty (no app tables / no `_prisma_migrations` history you care about).
3. Agent/human must show the target branch and ask for approval before `migrate deploy` or any schema-changing command.
4. Initial migration folder: `prisma/migrations/20261111140000_init/`.
5. Stage 3A mapping table: `prisma/migrations/20261111153000_external_identity/` — applied on development after approval.
6. Stage 4B invitations: `prisma/migrations/20261111183000_supplier_invitation/` — applied on development after approval.
7. Stage 4C self-registration: `prisma/migrations/20261112040000_supplier_self_registration/` — applied on development after approval.

### Applied migration (Stage 3A)

| Field | Value |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Applied on | **development** (`br-morning-glade-b3odmb6e`) |
| Not applied | production (`br-fancy-voice-b33wenqw`) |
| Migration | `20261111153000_external_identity` |
| Change | Create `ExternalIdentity` + FK to `User` |

### Applied migration (Stage 4B)

| Field | Value |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Applied on | **development** (`br-morning-glade-b3odmb6e`) |
| Not applied | production |
| Migration | `20261111183000_supplier_invitation` |
| Change | Create `InvitationStatus` enum + `SupplierInvitation` table |

### Applied migration (Stage 4C)

| Field | Value |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Applied on | **development** (`br-morning-glade-b3odmb6e`) |
| Not applied | production |
| Migration | `20261112040000_supplier_self_registration` |
| Change | `REJECTED` status, `SupplierRegistrationSource`, rejection/review columns |

## Verification checklist

- [x] `npx prisma validate` passes  
- [x] `npx prisma generate` succeeds  
- [x] Migration `20261111140000_init` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261111153000_external_identity` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261111183000_supplier_invitation` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261112040000_supplier_self_registration` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] `GET /api/health/db` returns `{ "ok": true, "database": "up" }`  
- [x] `npm run lint`, `npm run typecheck`, `npm run build` pass  

Production branch was not migrated.

## Not in Stage 2B

Authentication, business seed data, feature APIs beyond the health check.
