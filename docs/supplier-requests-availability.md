# Supplier requests & availability (Stage 5B)

## Scope

- Distribute confirmed requirements to matching suppliers
- Supplier availability draft/submit (qty, delivery date, not available)
- Seven-day UTC reserve on positive submitted availability
- Company review of sent requests and responses
- Audit logs + in-app notifications

**Not in 5B:** purchase order writes (see Stage 6A1), deliveries, GRN, live Cosmo/ERP APIs.

Stage 6A1 allocation entry: `/staff/requests/[id]` → **Allocate order** (requires `ALLOCATE_ORDER` plus submitted availability with an active reserve). See [orders-allocation.md](orders-allocation.md).

## Permissions

| Action | Permission | Notes |
| --- | --- | --- |
| Draft/edit requirements | `MANAGE_REQUIREMENTS` | Split from confirm; ADMIN bypasses |
| Confirm requirement | `CONFIRM_REQUIREMENT` | Unchanged |
| Distribute / list / review requests | `SEND_SUPPLIER_REQUEST` | ADMIN bypasses |
| Supplier respond | Supplier role + ownership | Cross-supplier → NOT_FOUND |

Post-migration backfill grants `MANAGE_REQUIREMENTS` to STAFF users who already had `CONFIRM_REQUIREMENT` (idempotent).

## Matching

A supplier is eligible when:

1. `status === ACTIVE`
2. `supportsAllBrands` **or** has `SupplierBrand` for the requirement brand
3. No active request (`NEW` / `PARTIALLY_RESPONDED` / `RESPONDED`) for the same requirement

Distribution modes: `ALL_MATCHING` or `SELECTED` (subset of eligible).

## Routes

| Path | Purpose |
| --- | --- |
| `/staff/requirements/[id]/distribute` | Preview matching suppliers and send |
| `/staff/osf-imports/[importId]/distribute` | Phase F1 guided multi-brand availability distribution |
| `/staff/requests` | Company list of sent requests |
| `/staff/requests/[id]` | Read-only availability review |
| `/supplier/requests` | Supplier inbox |
| `/supplier/requests/[id]` | Draft/submit availability |

## Phase F1 — OSF guided distribution

- One wizard for all **CONFIRMED** brand requirements on a confirmed OSF import.
- Reuses `filterMatchingSuppliers` and `distributeRequirementInTransaction` (same quantity / request semantics as manual distribute).
- Default request qty = `RequirementItem.quantityPlanned`; optional overrides require acknowledgment when over planned. Requirement quantities are never modified.
- Durable per-brand ledger: `OsfImportDistribution` (`IN_PROGRESS` / `SUCCEEDED` / `SKIPPED_ALREADY_REQUESTED` / `FAILED`).
- **Lock order (per brand txn):** `Requirement FOR UPDATE` → claim/reclaim ledger → create `SupplierRequest` + items + DB notifications + audit → complete ledger. Brands run in separate transactions.
- Idempotency key resolved outside interactive txns; pending key acquired before the brand loop; completed after aggregation. Same-key replay returns stored outcomes; changed payload → conflict.
- `SKIPPED_ALREADY_REQUESTED` is not a successful send. Retry failed brands only via `retryFailedOnly`. Future additional requests after success/skip need a separate explicit workflow (not F1).
- Does **not** create or modify Purchase Orders.

### Lock order and deadlock avoidance

1. Always lock `Requirement` first (`SELECT … FOR UPDATE`), then touch `OsfImportDistribution` for that same requirement.
2. Never lock two requirements in one transaction (per-brand txns), so multi-brand distributes cannot deadlock across brands.
3. SupplierRequest uniqueness + active-status skip inside the same txn prevents duplicate sends under concurrent different keys once a brand ledger reaches `SUCCEEDED`.
4. Unexpired foreign `IN_PROGRESS` claims raise `VERSION_CONFLICT` without overwriting; expired claims are reclaimable.

### Quantity extension point (F2 / Cosmo suggestions)

F1 builds a single `Map<requirementItemId, Decimal>` via `buildQuantityByItemId` and applies it to **every** recipient in `distributeRequirementInTransaction`.

Future per-supplier / per-item suggestions should replace that map with a nested structure (e.g. `Map<supplierId, Map<requirementItemId, Decimal>>`) at the call site into `distributeRequirementInTransaction` — without changing `RequirementItem.quantityPlanned` or inventing a parallel create path.

## Availability rules

- Empty qty on submit = leave unanswered (pending).
- Qty `0` or “Not available” → `NOT_AVAILABLE` (no reserve).
- Positive qty + delivery date → `SUBMITTED` with `reservedAt` / `reserveExpiresAt = reservedAt + 7×24h` (UTC ms).
- While status stays `SUBMITTED`, quantity edits **do not** reset the reserve clock.
- Fresh clock only when entering `SUBMITTED` from another status (including after `EXPIRED` / `CANCELLED` / `NOT_AVAILABLE` / `DRAFT`).
- Concurrent edits guarded by `AvailabilityOffer.version`.
- Lazy expiry: reads/writes transition past-due `SUBMITTED` → `EXPIRED`.
- Staff cannot fabricate supplier availability (review is read-only).

## Dates

- `AvailabilityOffer.availableDate` is a **calendar date** (day only). Stored as `DateTime` at UTC midnight of that day; displayed with UTC calendar formatting so Supplier/Staff/Admin see the same day (no local timezone shift such as “5:30 AM”).
- Shared helpers: `src/lib/dates.ts` (`parseCalendarDateInput`, `formatCalendarDate`, `formatDateTime`, `toCalendarDateInputValue`).
- Event timestamps (`reservedAt`, `reserveExpiresAt`, `sentAt`, `responseDeadline`, `respondedAt`) remain true instants and use `formatDateTime`.

## Notifications & audit

- Distribute → notify active supplier users; audit `SUPPLIER_REQUESTS_DISTRIBUTED`.
- Submit → notify company ADMIN/STAFF; audit `AVAILABILITY_SUBMITTED` (and decrease-aware title when qty drops on a live submit).

## Schema (migration `20261112060000_stage5b_requests_availability`)

- Enum: `StaffPermissionCode.MANAGE_REQUIREMENTS`
- Column: `SupplierRequest.responseDeadline` (nullable)
- Index: `SupplierRequest_companyId_responseDeadline_idx`

`AvailabilityOfferStatus.NOT_AVAILABLE` already existed.

## Unresolved business decisions

- Exact staff permission catalog UX / default grants for new STAFF users
- Whether response deadline should auto-expire unanswered lines
- Allocation / order rules when ordering above plan (later stage)
- Price fields on availability (requirements mention price; not modeled in 5B)
