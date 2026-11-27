# Proposed migration — Delivery scheduling & company receipt

**Status:** Applied on Neon **development** + app implemented (see `IMPLEMENTATION-REPORT.md`).  
**Target:** Neon development only (`br-morning-glade-b3odmb6e`). Production forbidden.  
**Migrations:** `20261117120000_delivery_scheduling`, `20261117120100_delivery_scheduling_checks`  
**Rehearsal history:** `REHEARSAL-FINAL-REPORT.md`

## Why a migration is required

Current `Delivery.status = SUBMITTED` means *supplier claimed a physical delivery* (past `deliveredAt` only, pending company verify). The new business rule is:

1. Supplier **schedules** planned qty + **future-capable** planned date (not receipt).
2. Company records **actual received qty + actual receipt date**, then verifies + issues GRN.
3. Scheduling must **not** look like goods already arrived.

Reusing `SUBMITTED` for future schedules would violate the product rule: *do not represent future schedules as already SUBMITTED physical deliveries.* Additive enum values + columns are required.

## Existing schema (reuse)

| Piece | Role after change |
| --- | --- |
| `PurchaseOrder` / `OrderItem` | Unchanged. `quantityVerifiedReceived` still only moves on verify. `originalExpectedDeliveryAt` preserved. |
| `Delivery` / `DeliveryItem` | Persist schedules and legacy submissions. `quantityDelivered` = planned (schedule) or supplier-claimed (legacy SUBMITTED). |
| `Grn` / `GrnItem` | Unchanged. Still 1:1 with verified `Delivery`; insert-only. |
| Capacity invariant | Extend holds to include `SCHEDULED` (same as SUBMITTED). Verified + active holds ≤ open ordered. |
| Verify + GRN txn | Reuse; accept `SCHEDULED` (and legacy `SUBMITTED`); require actual `receivedAt`. |
| Permissions | Keep `VERIFY_DELIVERY` + `ISSUE_GRN` (ADMIN bypass). |
| Idempotency / audit / notifications | Reuse scopes/patterns; new audit action strings are app-level (`String`). |

## Additive changes

### Enum `DeliveryStatus`

| Value | Hold capacity? | Received? | Meaning |
| --- | --- | --- | --- |
| `SUBMITTED` | Yes | No | **Legacy** physical submission (existing UAT rows). |
| `SCHEDULED` | Yes | No | **New** planned delivery; goods not received. |
| `VERIFIED` | Via `quantityVerifiedReceived` | Yes | Company verified + GRN. |
| `REJECTED` | No | No | Flagged / rejected (unchanged). |
| `SUPERSEDED` | No | No | **New** prior schedule replaced by reschedule (history). |

### `Delivery` columns

| Column | Type | Notes |
| --- | --- | --- |
| `plannedDeliveryAt` | `TIMESTAMP(3)?` | Required for `SCHEDULED`. Future dates allowed (app). |
| `receivedAt` | `TIMESTAMP(3)?` | Set by company at verify/receipt. Today/past only (Asia/Colombo, app). |
| `rescheduleReason` | `TEXT?` | Required when creating a superseding schedule. |
| `supersedesDeliveryId` | `TEXT?` | FK → prior `Delivery` (same PO). Prior row → `SUPERSEDED`. |

`deliveredAt` remains for legacy `SUBMITTED` physical dates. New schedules use `plannedDeliveryAt` and leave `deliveredAt` null until/unless needed for display compatibility.

### Indexes / FK

- Index `(companyId, status, plannedDeliveryAt)` for upcoming/overdue company lists.
- Index `(supplierId, status, plannedDeliveryAt)` for supplier upcoming.
- Index `supersedesDeliveryId`.
- FK `Delivery_supersedesDeliveryId_fkey` → `Delivery(id)` `ON DELETE RESTRICT`.

## Compatibility with existing Delivery / GRN

- **No row updates** in migration SQL. Existing `SUBMITTED` / `VERIFIED` / `REJECTED` and all GRNs stay as-is.
- Existing verify UI continues to work for legacy `SUBMITTED` until app cutover.
- After app cutover: supplier creates `SCHEDULED` only; company verify accepts `SCHEDULED` (+ legacy `SUBMITTED`); partial receipt of scheduled 10 verified as 6 frees shortfall 4 for a new schedule (hold ends when status leaves active hold states).
- Reschedule: insert new `SCHEDULED`, set prior to `SUPERSEDED` with reason — never UPDATE historical qty/dates on the prior row; never touch GRNs.
- PO price snapshots (`OrderItem.unitPrice`) untouched.

## App work (after migrate approval + deploy)

Not done in this stop:

1. Supplier “Schedule Delivery” (replace primary Submit Delivery UX); allow future planned dates.
2. Reschedule with reason → supersede chain.
3. Company upcoming/overdue schedules; Record Receipt = actual qty + `receivedAt` + verify/GRN atomic.
4. Holds query: `status IN ('SUBMITTED','SCHEDULED')`.
5. Dashboards + notifications for schedule create/change and verify/discrepancy.
6. Tests listed in the product brief.

## Apply sequence (only after explicit approval)

1. Review `migration.sql` + `schema.prisma.fragment` + this README.
2. Optionally rehearsal on a child of development.
3. Apply on Neon **development** only.
4. `prisma generate`.
5. Implement app layer + tests.

## Rollback

See `rollback.sql`. Enum value removal in PostgreSQL is awkward; prefer forward-fix if already deployed with data. Rollback drops columns/FK/indexes and does **not** remove enum labels once added (documented in rollback file).
