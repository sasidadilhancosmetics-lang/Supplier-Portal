# Decisions

Open items are not decided. Stage 2A updates are marked below.

## Decided

### Package name is `supplier-portal`

The workspace folder is `Supplier Portal`. npm rejects that name because of the space and capital letters. The folder stays as it is. `package.json` uses `supplier-portal`.

### Scaffold versions are the create-next-app defaults from this setup

Installed by `create-next-app` (app router, `src/`, `@/*`, Tailwind, ESLint):

- Next.js 16.4.6
- React 19.3.0
- Tailwind CSS 4.3.3
- TypeScript 5
- ESLint 9 with `eslint-config-next`

The generated `next.config.ts` enables `cacheComponents` and `partialPrefetching`. Those stay as generated. They are not a product decision about procurement caching.

### UI kit is shadcn/ui

shadcn/ui provides accessible primitives on top of Tailwind. `shadcn init --defaults` installed preset `base-nova` (Base UI, neutral palette, CSS variables). The shell uses those primitives instead of a second component library. Placeholder screens are labeled non-functional so a styled page is not mistaken for a finished workflow.

### Secret handling

`.gitignore` ignores `.env*` and keeps `.env.example` committable. Key and credential files are ignored. No real connection string is stored in the repo.

### Integration contracts are not invented

Cosmo OS / OSF and ERP field names, auth schemes, and endpoints are unknown. No client, mock payload, or environment variable for those systems is added until a contract exists. `OsfImport.payload` stores opaque JSON.

## Auth0 identity vs internal User (Stage 3A)

- Login provider: Auth0 via `@auth0/nextjs-auth0` v4 and Next.js 16 `src/proxy.ts`.
- Permanent app identity remains `User.id`. Auth0 `sub` is stored only on `ExternalIdentity` with `provider` + `providerIssuer` so a later company-owned tenant can be added without changing business keys.
- Unknown Auth0 sessions are not auto-provisioned and are never linked by email alone; they see `/access-pending`.
- Role and `supplierId` come from Postgres through server helpers (`src/lib/auth/guards.ts`), not client input or untrusted claims.

## Admin supplier management (Stage 4A)

- Admin routes under `/admin/suppliers` for list/search/filter, create, edit, and activate/deactivate (no hard delete).
- Brand removal and turning off All Brands are blocked while active supplier requests (`NEW` / `PARTIALLY_RESPONDED` / `RESPONDED`) would lose coverage.
- AuditLog records create/update/brand/status changes. No schema migration required.

## Supplier invitations and Auth0 linking (Stage 4B)

- ADMIN invites supplier users from `/admin/suppliers/[id]`; invitations store SHA-256 token hashes, expire in 72h, and bind supplier + SUPPLIER role + normalized email.
- Acceptance requires Auth0 login with verified email matching the invite; `ExternalIdentity` is created from exact issuer + `sub` only — never email-alone linking or ordinary-login auto-provision.
- Invitation input cannot grant ADMIN/STAFF. Disabled users and inactive suppliers remain blocked by existing guards.
- Supplier self-service profile at `/supplier/profile` (no status/company ownership changes). Migration: `20261111183000_supplier_invitation` (development only after approval). See [suppliers-invitations.md](suppliers-invitations.md).

## Product master & requirements (Stage 5A)

- Manual product create is **PROVISIONAL** only; never invent `ERP_LINKED` / `erpItemId`.
- Staff product/requirement actions use provisional `MANAGE_PRODUCTS` / `MANAGE_BRANDS` / `CONFIRM_REQUIREMENT` (ADMIN bypass).
- Draft requirements share `createDraftRequirementForCompany` for future Cosmo OS adapter reuse; OSF payload mapping is explicitly unimplemented.
- Confirmed requirements are not silently editable; confirm uses an atomic status claim.
- See [requirements-management.md](requirements-management.md). No schema migration.

## Order allocation (Stage 6A1) and confirmation (Stage 6A2)

- Create `PurchaseOrder` (`SENT`) + `OrderItem` lines from submitted availability; every line requires `availabilityOfferId`.
- **Requirement-level concurrency:** `SELECT … FOR UPDATE` on touched `RequirementItem` ids (sorted), then offers (sorted); recalculate coverage after locks so normal in-plan allocations cannot collectively exceed remaining plan across suppliers.
- Idempotency: existing `IdempotencyKey` with payload hash in `responseJson`, claim+complete in the same transaction, **30-day** retention; same key+hash replays; mismatch rejected.
- Audit: `AuditLog.entityType` is a string — use `"PurchaseOrder"` (TypeScript union only). **No migration.**
- Calendar `availableDate` copied to `originalExpectedDeliveryAt` without timezone shift; reserves stay UTC instants and are not moved.
- **6A2:** supplier whole-order confirm `SENT → CONFIRMED` (`confirmedAt`, `version++`); ownership by session `supplierId`; confirm idempotency scope `po.confirm:{actorUserId}`; notify ADMIN + ALLOCATE_ORDER staff + allocate actor; staff cannot confirm for suppliers.
- **6A3:** supplier-only cancel of `SENT`/`CONFIRMED`; mandatory reason ≤500; release `quantityOrderedActive` + `ORDER_ALLOCATION_RELEASED`; preserve reserves; reject `DELIVERY_HOLD`; idempotency `po.cancel:{actorUserId}` bound to reason; staff re-request via existing distribute (no auto-reallocation). See [orders-allocation.md](orders-allocation.md).

## Supplier requests & availability (Stage 5B)

- Draft editing uses `MANAGE_REQUIREMENTS`; confirm stays `CONFIRM_REQUIREMENT`. Idempotent backfill after migration for existing CONFIRM grants.
- Matching: ACTIVE + (All Brands or brand membership); skip suppliers with an open request for that requirement.
- Reserve = `reservedAt + 7×24h` UTC; no clock reset while status remains `SUBMITTED`; fresh clock only when re-entering `SUBMITTED` after `EXPIRED` / `CANCELLED` / `NOT_AVAILABLE` / `DRAFT`.
- Zero qty / not available → `NOT_AVAILABLE` (no reserve). Unanswered lines stay pending.
- Optional `SupplierRequest.responseDeadline`. Staff review is read-only. Migration: `20261112060000_stage5b_requests_availability` (development after approval). See [supplier-requests-availability.md](supplier-requests-availability.md).
- Delivery `availableDate` is calendar-day semantics on a DateTime column (UTC midnight + UTC display); no column migration.
- UI is **dark-first**: background `#050505`, cards `#141414`, secondary `#1E1E1E`, borders `#303030`, text `#FFFFFF` / muted `#A3A3A3`, primary accent `#39FF14` with black label text. Tokens live in `globals.css` (`html.dark`); do not mix light layouts.

## Supplier self-registration (Stage 4C)

- Unlinked Auth0 users with verified email may register a new supplier company (`registrationSource = SELF`, status `PENDING_REVIEW`).
- Registration creates `Supplier` + `SUPPLIER` `User` + `ExternalIdentity` atomically; client cannot set role/companyId/supplierId/status.
- Protected supplier data stays blocked until ADMIN approval (`ACTIVE`). Rejection uses status `REJECTED` with required reason (distinct from `INACTIVE` deactivation) and an in-app notification.
- See [suppliers-self-registration.md](suppliers-self-registration.md). Migration: `20261112040000_supplier_self_registration` (development after approval).

## Authorization foundation (Stage 3B)

- Central helpers: `requireAuthenticatedUser`, `requireAdmin`, `requireStaffPermission`, `requireSupplier`, `requireSupplierOwnership`.
- Staff actions deny by default unless a `StaffPermission` row exists; ADMIN bypasses staff permission checks unless explicitly disabled.
- Only ADMIN may manage staff permission grants (no self-elevation).
- Supplier isolation uses DB `User.supplierId` and `Supplier.status === ACTIVE`; cross-supplier access returns 404.
- No schema migration for Stage 3B — existing `StaffPermission` / `Supplier.status` fields are enough. See [authorization.md](authorization.md).

### Performance scoring waits

The 90-day score is specified, but it depends on stable orders, deliveries, and exceptions. Scoring tables are not in the Stage 2A schema. Original expected delivery dates are preserved on orders/items for later use.

### Phase 1 purchasing tenancy is single-company (Stage 2A)

One purchasing `Company`. Many `Supplier` companies connect to it. Multi-purchasing-company tenancy is out of scope for Phase 1.

### Supplier users are multi-login, company-scoped (Stage 2A)

Multiple `User` rows may belong to one `Supplier`. MVP UI may still present a single primary supplier user. All supplier data access must be scoped by `supplierId`.

### Prisma + Neon runtime (Stage 2B)

Prisma ORM 7.10.x. Runtime uses pooled `DATABASE_URL` with `@prisma/adapter-neon`. Migrate uses `DATABASE_URL_UNPOOLED` (alias `DIRECT_DATABASE_URL`) in `prisma.config.ts`. Initial migration is prepared under `prisma/migrations/`; apply only to an approved empty development database, never production without explicit approval.

### Provisional numeric precision (Stage 2A)

Until currency/UOM/scale rules are confirmed: quantities `Decimal(18, 4)`, prices `Decimal(18, 2)`, optional `currencyCode` / `unitOfMeasure` strings.

### Availability counters (Stage 2A revision)

Use `quantityDeclared` (supplier latest declaration) and `quantityOrderedActive` (sum of ACTIVE order lines). Do not use a cancelled counter in remaining-qty math. Do not add a CHECK that blocks decreasing declared quantity below ordered quantity.

### Brand matching data (Stage 2A revision)

`Product.brandId`, `Requirement.brandId`, `Supplier.supportsAllBrands`, and `SupplierBrand` support brand-specific OSF requirements and All Brands registration. Active-request brand removal remains application-enforced.

### Partial cancel after delivery (Stage 2A final)

Order lines keep `quantityOrdered`, `quantityCancelled`, and `quantityVerifiedReceived`. Cancelling releases only undelivered qty to outstanding demand; verified receipts and GRNs stay. `quantityOrderedActive` decreases by the cancelled amount only.

### Composite ownership FKs (Stage 2A final)

Where practical, child rows use composite foreign keys on `(parentId, supplierId[, companyId])`. Authorization and ignoring client ownership ids remain application concerns.

### Provisional products (Stage 2A final)

`Product.masterStatus` is `PROVISIONAL` or `ERP_LINKED`. Offer-to-order may create provisional portal products only; it does not create ERP master items.

## Phase B OSF import review (schema on development)

Applied after rehearsal on a disposable child branch, then to development only (`20261112120000_phase_b_osf_import_review`). Production not migrated. Application ingest / Import Review / distribute (Phases C–H) are **not** started by this decision.

Confirmed schema rules:

- One brand-scoped requirement per import (`Requirement` unique on `(osfImportId, brandId)`; NULL import = manual drafts unconstrained).
- No `SupplierRequest` database uniqueness for “one open request per supplier”. Additional availability requests remain an application-level concern so a permanent DB partial index cannot block them.
- Distribution ledger unique on `(osfImportId, requirementId)` with statuses `IN_PROGRESS` / `SUCCEEDED` / `SKIPPED_ALREADY_REQUESTED` / `FAILED`. Skipped is a terminal no-new-requests outcome, not a failure.
- Multiple active `IntegrationCredential` rows per company/cosmo binding are allowed (token rotation); revoke sets `revokedAt` + `isActive=false` together.
- Ingest never auto-creates products/brands; unmatched lines stay visible (`UNKNOWN_*` / `REJECTED_*` / `EXCLUDED`).

### CHECK constraints (not modelled by Prisma)

Prisma migrate diff ignores these. Do **not** drop them in future migrations. Assert with `pg_constraint` / the Phase B verify script after any schema change.

| Constraint | Table |
| --- | --- |
| `OsfImport_version_positive_chk` | OsfImport |
| `OsfImport_confirmed_fields_chk` | OsfImport |
| `OsfImportLine_sourceIndex_nonneg_chk` | OsfImportLine |
| `OsfImportLine_quantityProposed_nonneg_chk` | OsfImportLine |
| `OsfImportLine_quantityPlanned_nonneg_chk` | OsfImportLine |
| `OsfImportLine_version_positive_chk` | OsfImportLine |
| `OsfImportLine_matched_requires_product_chk` | OsfImportLine |
| `OsfImportLine_item_link_chk` | OsfImportLine |
| `OsfImportDistribution_attemptCount_nonneg_chk` | OsfImportDistribution |
| `OsfImportDistribution_version_positive_chk` | OsfImportDistribution |
| `OsfImportDistribution_in_progress_claim_chk` | OsfImportDistribution |
| `OsfImportDistribution_terminal_no_claim_chk` | OsfImportDistribution |
| `OsfImportDistribution_succeeded_fields_chk` | OsfImportDistribution |
| `OsfImportDistribution_skipped_fields_chk` | OsfImportDistribution |
| `OsfImportDistribution_failed_fields_chk` | OsfImportDistribution |
| `IntegrationCredential_revoked_inactive_chk` | IntegrationCredential |

## Open

- Final staff permission catalog (`StaffPermissionCode` is provisional)
- Matching rules for suppliers and brands beyond brand membership
- Reserve and offer window: 7×24 hours vs calendar days; timezone
- Self-registration activation (`PENDING_REVIEW` vs immediate `ACTIVE`)
- Notification delivery channel (in-app model exists; email unresolved)
- GRN correction process after immutability
- Source/lifecycle of "existing products" while catalog management is Phase 2
- Cosmo OS / OSF and ERP API contracts
- Ordering above planned quantity: accounting rules
- Repeated cancellation threshold and manual handling
