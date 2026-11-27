# Phase F2 — Child-branch migration rehearsal report

**Date:** 2026-11-13  
**Status:** Rehearsal complete. Development and production **not** migrated.

## 1. Rehearsal branch ID and endpoint

| Branch | ID | Endpoint host (non-secret) | Role |
| --- | --- | --- | --- |
| `rehearsal-phase-f2-20261113` | `br-calm-frog-b3oi1r36` | `ep-fancy-poetry-b3mvbms2.c-4.ap-southeast-1.aws.neon.tech` (+ `-pooler`) | **Kept migrated** for review |
| `rehearsal-phase-f2-rollback-20261113` | `br-patient-firefly-b38emdeq` | `ep-super-breeze-b3k2egr8.c-4.ap-southeast-1.aws.neon.tech` | Migrate → rollback drill |
| Parent development | `br-morning-glade-b3odmb6e` | unchanged | **Untouched** (confirmed no F2 objects) |
| Production | `br-fancy-voice-b33wenqw` | — | **Not accessed for mutation** |
| Existing backups | `br-shy-river-b34hfq0v`, `br-hidden-cake-b3s3sjyz` | — | **Not deleted** |

Parent: `holy-art-38015209` / `development`. Children created with `parent-data` from development.

## 2. Migration result

| Target | Result |
| --- | --- |
| Main rehearsal | `migration.sql` applied in one transaction — **COMMITTED** |
| Rollback rehearsal | `migration.sql` COMMITTED, then `rollback.sql` COMMITTED |
| Reviewed SQL altered during apply? | **No** — used `prisma/proposed/phase-f2/migration.sql` as reviewed |

## 3. Constraint and FK test results

| Test | Result |
| --- | --- |
| Table `OsfRequestSuggestion` exists | PASS |
| Enum values (4) | PASS |
| Uniques on `OsfImportLine` (id/company, triple, quad lineKey) | PASS |
| Unique `Supplier (companyId, externalId)` | PASS |
| Insert UNRESOLVED (`supplierId` NULL) | PASS |
| Insert MATCHED (same-company supplier) | PASS |
| Reject duplicate `(import, line, cosmoSupplierId)` | PASS |
| Reject qty ≤ 0 | PASS |
| Reject MATCHED without supplier / UNRESOLVED with supplier | PASS |
| Reject mismatched `lineKey` vs `osfImportLineId` (quad FK) | PASS |
| Reject cross-company supplier FK | PASS |
| Reject duplicate non-null `externalId` same company | PASS |

Fixture suggestion rows deleted after drills (`suggestionRows = 0` on main rehearsal).

## 4. Prisma drift results

- Temporary datamodel `tmp-f2-rehearsal/schema.with-f2.prisma` **validates** (`prisma validate` OK).
- Prisma 7 removed `--from-url` on `migrate diff`; full empty-script drift via config datasource was not used against rehearsal.
- Equivalent verification: live DB FK/CHECK/index inventory matches proposed SQL (quad FK, company FKs, qty + mapping CHECKs, all uniques present).
- Note: CHECKs are SQL-only (not expressible as first-class Prisma fields); expect them to remain in migration SQL when promoting to `prisma/migrations/`.

## 5. Existing data comparison

Preflight snapshot hash of 12 OSF lines:  
`bb7478754802fd6533606637b31d6c59c9dfd693ff08d5310b7fe622dfa6ff70`

| Metric | Parent snapshot | Main rehearsal after migrate | Match |
| --- | --- | --- | --- |
| OsfImportLine count | 12 | 12 | Yes |
| Line content hash | (above) | same | Yes |
| Supplier count / externalId non-null | 2 / 0 | 2 / 0 | Yes |
| SupplierRequest count | 3 | 3 | Yes |
| PurchaseOrder count | 1 | 1 | Yes |

## 6. Protected PO verification

`PO-20261112-E5D42983` = **CONFIRMED** on parent snapshot, main rehearsal (post-migrate), and rollback branch (post-rollback).

## 7. Rollback drill results

On `br-patient-firefly-b38emdeq`:

| After rollback | Result |
| --- | --- |
| `OsfRequestSuggestion` table | gone |
| Mapping enum | gone |
| New `OsfImportLine` / `Supplier` F2 uniques | gone |
| OsfImportLine count | 12 preserved |
| Protected PO | CONFIRMED |

## 8. Warnings / blockers

1. Prisma 7 `migrate diff --from-url` unavailable — promote using reviewed SQL + validate merged schema (done for temp schema).
2. Unique index name for suggestions may truncate in Postgres error text; constraint still works.
3. Application F2 code still not implemented (by design).
4. Development parent migration still **requires explicit approval**.

## 9. Recommendation for development migration

**Recommend approve** applying the same reviewed `prisma/proposed/phase-f2/migration.sql` to development (`br-morning-glade-b3odmb6e`) after:

1. Copy into `prisma/migrations/<timestamp>_phase_f2_request_suggestions/migration.sql`
2. Merge `schema.prisma.fragment` (+ CHECK notes) into `prisma/schema.prisma`
3. Apply on development with unpooled URL only
4. Re-run object + protected-PO verification

Keep `rehearsal-phase-f2-20261113` available until development apply is confirmed.
