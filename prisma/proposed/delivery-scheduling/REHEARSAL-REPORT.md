# Delivery Scheduling — Migration Rehearsal & Safety Review

**Date:** 2026-11-17  
**Status:** Schema review complete; **child-branch apply/rollback blocked** by Neon branch limit. Development parent untouched. Production untouched.

## 1. Schema review findings

### Parent identity (verified)

| Branch | Id | Role |
| --- | --- | --- |
| `development` | `br-morning-glade-b3odmb6e` | Parent for rehearsal (not migrated) |
| `production` | `br-fancy-voice-b33wenqw` | Untouched |

Project: `holy-art-38015209`

### Development baseline (read-only)

| Metric | Value |
| --- | --- |
| Delivery | 3 (SUBMITTED 1, VERIFIED 2) |
| DeliveryItem | 3 |
| Grn / GrnItem | 2 / 2 |
| PurchaseOrder | 2 |
| PO-20261116-260A4C29 | `DELIVERED` |
| PO-20261112-E5D42983 | `CONFIRMED` |

### Design assessment

| Topic | Result |
| --- | --- |
| Additive enum `SCHEDULED` / `SUPERSEDED` | OK — legacy `SUBMITTED`/`VERIFIED`/`REJECTED` preserved |
| Distinct `plannedDeliveryAt` vs `receivedAt` | OK |
| History via supersede chain (no in-place plan rewrite) | OK |
| GRN / verified rows unchanged by DDL | OK (no DML) |
| Prisma fragment relations | Valid (`prisma validate` on merged rehearsal schema) |

### Original proposal gaps (corrected in proposed files before apply)

1. **Cross-order supersede** — plain FK on `supersedesDeliveryId` alone allowed linking to another PO’s delivery.  
   **Fix:** `@@unique([id, purchaseOrderId])` + composite FK `(supersedesDeliveryId, purchaseOrderId) → (id, purchaseOrderId)`.
2. **Self-supersede** — allowed by FK alone.  
   **Fix:** `CHECK (supersedesDeliveryId IS NULL OR supersedesDeliveryId <> id)`.
3. **SCHEDULED without planned date / reschedule without reason** — app-only originally.  
   **Fix:** optional `migration-step2-checks.sql` (must run **after** enum ADD VALUE commits).
4. **Outer `BEGIN`/`COMMIT` around `ALTER TYPE ... ADD VALUE`** — fragile with transactional migrate runners.  
   **Fix:** removed wrapper from `migration.sql`; documented two-step apply for status CHECKs.

Longer supersede cycles (A→B→A) and “only supersede `SCHEDULED`” remain **application-enforced** (same pattern as price-agreement integrity).

## 2. Required corrections

Already written into:

- `migration.sql` (composite same-PO FK, self-check, no txn wrapper)
- `migration-step2-checks.sql` (optional status CHECKs)
- `rollback.sql` (drops new constraints/indexes/columns)
- `schema.prisma.fragment` / `schema.diff`
- `CAPACITY-AND-PARTIAL-RECEIPT.md`

No further schema corrections identified before rehearsal apply.

## 3. Child branch identities

| Intended | Result |
| --- | --- |
| `rehearsal-delivery-scheduling-apply` | **NOT CREATED** — `branches limit exceeded` (HTTP 422) |
| `rehearsal-delivery-scheduling-rollback` | **NOT CREATED** — same |

Existing disposable children (not used; not deleted per restriction):

- `rehearsal-price-fk-20261113` (`br-wandering-forest-b3i65daq`)
- `rehearsal-price-negotiation-rollback-20261113` (`br-dry-waterfall-b3nv6qfh`)
- `rehearsal-price-negotiation-20261113` (`br-autumn-flower-b3z162k9`)
- plus older phase-f2 / phase-b / backup branches

## 4. Rehearsal apply result

**Not run** — no fresh child available. Development parent **not** migrated.

Offline: merged Prisma rehearsal schema **valid** (`schema.rehearsal.prisma`).

## 5. Constraint results

**Not run on Neon** (blocked). Planned checks after apply:

- Insert `SCHEDULED` with `plannedDeliveryAt` succeeds
- `SCHEDULED` without planned date fails step-2 CHECK
- Supersede to other PO’s delivery fails composite FK
- Self-supersede fails CHECK
- Reschedule without reason fails step-2 CHECK
- Legacy `SUBMITTED`/`VERIFIED` counts and GRN ids unchanged vs baseline
- Protected PO numbers/statuses unchanged

## 6. Capacity / partial-receipt design checks

Documented in `CAPACITY-AND-PARTIAL-RECEIPT.md`:

- Active holds = `SUBMITTED` + `SCHEDULED` only; `SUPERSEDED` does not hold
- Schedule never bumps `quantityVerifiedReceived` or issues GRN
- Partial verify: keep planned qty history on the row; status → `VERIFIED`; GRN for received; shortfall freed for a **new** schedule (not `SUPERSEDED`)
- `SUPERSEDED` only for pre-receipt reschedule
- Concurrency via existing PO/line locks + idempotency
- Cancel vs holds: extend `DELIVERY_HOLD` to include `SCHEDULED` (app; no Stage 7 invent)

## 7. Rollback result

**Not run** — no rollback child.

Rollback SQL reviewed: drops CHECKs/FKs/indexes/columns; **leaves enum labels** (Postgres limitation). Safe only when no rows use `SCHEDULED`/`SUPERSEDED`.

## 8. Remaining development migration blockers

1. **Neon branch limit** — cannot create apply/rollback children without freeing slots.
2. Need explicit approval for **one** of:
   - Raise project branch limit, then create two new rehearsal children from `development`; or
   - Delete named disposable rehearsals (e.g. price-negotiation / phase-f2 leftovers) to free ≥2 slots; or
   - `reset_from_parent` on two named disposable children (discards their old state; does not delete), then rename for this rehearsal.
3. After child apply + rollback green: separate approval to migrate **development parent**.
4. Feature implementation still gated on (3).

---

**Stop for review.** No development parent migration. No production changes. No feature code. No branch deletions performed.
