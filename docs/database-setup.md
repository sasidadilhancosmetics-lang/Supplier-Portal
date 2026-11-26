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

### Branches

| Branch | ID | Notes |
| --- | --- | --- |
| production | `br-fancy-voice-b33wenqw` | Default branch. Never migrate or modify without explicit approval. |
| development | `br-morning-glade-b3odmb6e` | Endpoint `ep-little-credit-b35km102`. **No expiration date.** |
| rehearsal-phase-b-20261112 | `br-hidden-cake-b3s3sjyz` | Disposable child of development for the Phase B migration rehearsal (endpoint `ep-muddy-bird-b3hsfby3`). Delete after review. |

**Development expiry removed (2026-11-12, user-approved):** development was created with `expires_at = 2026-11-18T09:06:03Z`, which would have auto-deleted the branch and its data (including UAT data and confirmed purchase orders). Neon also refuses to create child branches (rehearsal, backup) from a branch with an expiration date. The expiry was removed with `neon branches set-expiration br-morning-glade-b3odmb6e --project-id holy-art-38015209` (no `--expires-at`). Only branch metadata changed; no schema or data. Do not set an expiry on development again without approval — it blocks backup branches.

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
8. Stage 5B requests/availability: `prisma/migrations/20261112060000_stage5b_requests_availability/` — applied on development after approval.
9. Phase B OSF import review: `prisma/migrations/20261112120000_phase_b_osf_import_review/` — applied on development after rehearsal + approval. Production not migrated.

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

### Applied migration (Phase B — OSF import review)

| Field | Value |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Applied on | **development** (`br-morning-glade-b3odmb6e`, endpoint `ep-little-credit-b35km102`) |
| Not applied | production (`br-fancy-voice-b33wenqw`) |
| Migration | `20261112120000_phase_b_osf_import_review` |
| SHA256 | `F9A5A2F181F2DBCBDBEBDDF5C03FA34054EAF822F1B2DA6EBB91182E9FAFC278` |
| Rehearsal | `rehearsal-phase-b-20261112` (`br-hidden-cake-b3s3sjyz`) — kept for review |
| Backup | `backup-pre-phase-b-20261113` (`br-shy-river-b34hfq0v`, endpoint `ep-billowing-firefly-b35jknx2`) — kept |
| Change | `OsfImportLine`, `OsfImportDistribution`, `IntegrationCredential`; `OsfImport` review columns; enum additions including `SKIPPED_ALREADY_REQUESTED`; composite company-isolation FKs; 16 CHECK constraints (Prisma does not model them — see [decisions.md](decisions.md)) |

## Verification checklist

- [x] `npx prisma validate` passes  
- [x] `npx prisma generate` succeeds  
- [x] Migration `20261111140000_init` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261111153000_external_identity` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261111183000_supplier_invitation` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261112040000_supplier_self_registration` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261112060000_stage5b_requests_availability` applied on **development** (`br-morning-glade-b3odmb6e`)  
- [x] Migration `20261112120000_phase_b_osf_import_review` applied on **development** (`br-morning-glade-b3odmb6e`) after rehearsal  
- [x] `GET /api/health/db` returns `{ "ok": true, "database": "up" }`  
- [x] `npm run lint`, `npm run typecheck`, `npm run build` pass  

Production branch was not migrated.

## Not in Stage 2B

Authentication, business seed data, feature APIs beyond the health check.
