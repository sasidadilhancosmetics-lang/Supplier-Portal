# Delivery Scheduling — Final Rehearsal Report

**Date:** 2026-11-17  
**Project:** `holy-art-38015209`  
**Status:** Child-branch rehearsal **PASSED**. Development parent **not** migrated. Production untouched.

## 1. Branch deletion preflight (`br-hidden-cake-b3s3sjyz`)

| Check | Result |
| --- | --- |
| Project / ID | `holy-art-38015209` / `br-hidden-cake-b3s3sjyz` (`rehearsal-phase-b-20261112`) |
| Not production / not development | Pass |
| Not Phase B backup (`br-shy-river-b34hfq0v`) | Pass — distinct backup preserved |
| No children | Pass |
| Runtime / `.env.local` deps | Pass — none; compute idle since 2026-11-13 |
| Unique data worth keeping | Pass — 0 Delivery, 0 GRN, 1 PO; migrations only through Phase B; stale Nov 12 rehearsal |

## 2. Deletion result

- **Deleted:** `br-hidden-cake-b3s3sjyz` only  
- **Preserved:** `br-shy-river-b34hfq0v` (`backup-pre-phase-b-20261113`) and all other branches  
- Branch count after delete: **9** (slot freed)

## 3. Reset results

| Branch | ID | `reset_from_parent` | Parent LSN after reset |
| --- | --- | --- | --- |
| APPLY | `br-autumn-flower-b3z162k9` | Success (`last_reset_at` 2026-11-17T10:31:45Z) | matches development `0/35D0388` |
| ROLLBACK | `br-dry-waterfall-b3nv6qfh` | Success (`last_reset_at` 2026-11-17T10:32:08Z) | matches development `0/35D0388` |

Post-reset baseline (= development): Delivery 3 (SUBMITTED 1, VERIFIED 2), GRN 2, PO 2 including protected `PO-20261116-260A4C29` DELIVERED / `PO-20261112-E5D42983` CONFIRMED. Endpoints unchanged (`ep-dawn-grass-…`, `ep-misty-paper-…`).

## 4. Migration apply results (`br-autumn-flower-b3z162k9`)

Applied `migration.sql` + `migration-step2-checks.sql`:

- Enums: `SCHEDULED`, `SUPERSEDED` added (legacy statuses kept)
- Columns: `plannedDeliveryAt`, `receivedAt`, `rescheduleReason`, `supersedesDeliveryId`
- Constraints/indexes: same-PO FK, self-check, planned-date CHECK, reschedule-reason CHECK, listing indexes

### Constraint / FK tests (6/6 pass)

| Test | Result |
| --- | --- |
| SCHEDULED without planned date | Rejected by CHECK |
| SCHEDULED with planned date | Allowed |
| Self-supersede | Rejected by CHECK |
| Cross-PO supersede | Rejected by same-PO FK |
| Reschedule without reason | Rejected by CHECK |
| Same-PO reschedule + SUPERSEDED prior | Allowed |

Fixture rows cleaned; legacy Delivery/GRN/PO counts unchanged after tests.

## 5. Rollback results (`br-dry-waterfall-b3nv6qfh`)

1. Applied same migration + step-2 (verified 4 new cols + 4 new constraints)  
2. Executed `rollback.sql`  
3. After rollback: **0** schedule columns, **0** new constraints, **0** new indexes  
4. Legacy Delivery 3 / GRN 2 / protected POs unchanged  
5. **Enum labels `SCHEDULED` / `SUPERSEDED` remain** (Postgres limitation; documented; no rows use them)

## 6. Prisma validation

`prisma validate --schema prisma/proposed/delivery-scheduling/schema.rehearsal.prisma` — **valid**.

## 7. Capacity / business safety (design confirmation)

Documented in `CAPACITY-AND-PARTIAL-RECEIPT.md`. Schema supports:

- Active holds = `SUBMITTED` + `SCHEDULED` only; `SUPERSEDED` releases hold  
- Schedule ≠ verified qty / ≠ GRN  
- Partial receipt: verify received qty, keep planned history, free shortfall for new schedule  
- Same-PO lineage enforced in DB; concurrency/idempotency/cancel-hold remain **application-enforced**

## Remaining blockers (development parent)

1. **Explicit approval** to apply `20261117120000_delivery_scheduling` (+ step-2 CHECKs) on **development** `br-morning-glade-b3odmb6e` only.  
2. Then: merge Prisma fragment, `prisma generate`, implement Schedule Delivery / company receipt UX + tests.  
3. Production: **not** approved.

Development parent currently still has **no** schedule DDL (verified).
