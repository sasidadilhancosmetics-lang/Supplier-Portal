# Supplier requests & availability (Stage 5B)

## Scope

- Distribute confirmed requirements to matching suppliers
- Supplier availability draft/submit (qty, delivery date, not available)
- Seven-day UTC reserve on positive submitted availability
- Company review of sent requests and responses
- Audit logs + in-app notifications

**Not in 5B:** purchase orders, allocation writes, deliveries, GRN, live Cosmo/ERP APIs.

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
| `/staff/requests` | Company list of sent requests |
| `/staff/requests/[id]` | Read-only availability review |
| `/supplier/requests` | Supplier inbox |
| `/supplier/requests/[id]` | Draft/submit availability |

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
