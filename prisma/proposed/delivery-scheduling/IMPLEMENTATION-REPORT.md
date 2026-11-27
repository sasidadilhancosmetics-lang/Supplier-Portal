# Delivery Scheduling — Implementation Report

**Date:** 2026-11-17  
**Migration target:** Neon development `br-morning-glade-b3odmb6e` (`ep-little-credit-b35km102`)  
**Production:** untouched (`br-fancy-voice-b33wenqw` forbidden)

## 1. Migration result

- Applied via `prisma migrate deploy` against development unpooled URL only
- Migrations:
  - `20261117120000_delivery_scheduling`
  - `20261117120100_delivery_scheduling_checks`
- Legacy data after apply: Delivery 3, GRN 2, protected POs unchanged
- `prisma validate` + `prisma generate` succeeded

## 2. Prisma validation

- `prisma validate` — valid
- `tsc --noEmit` — pass (after form/actions fixes)

## 3. Files changed (high level)

**Schema / migrations**
- `prisma/schema.prisma` (SCHEDULED/SUPERSEDED + Delivery columns/relations)
- `prisma/migrations/20261117120000_delivery_scheduling/`
- `prisma/migrations/20261117120100_delivery_scheduling_checks/`

**Domain**
- `src/lib/deliveries/schedule.ts`, `reschedule.ts`
- `src/lib/deliveries/holds.ts`, `verify.ts`, `schema.ts`, `idempotency.ts`, `constants.ts`, `status-labels.ts`, `queries.ts`
- `src/lib/orders/cancel.ts` (holds include SCHEDULED)
- `src/lib/dates.ts` (`isPastPortalCalendarDate`)
- `src/lib/dashboards/queries.ts`

**UI / actions**
- `src/components/supplier/schedule-delivery-form.tsx`, `reschedule-delivery-form.tsx`
- `src/app/supplier/orders/delivery-actions.ts`
- `src/app/supplier/orders/[id]/deliver/page.tsx`
- `src/app/supplier/orders/[id]/deliveries/[deliveryId]/reschedule/page.tsx`
- `src/app/supplier/deliveries/page.tsx`, order detail CTA
- `src/app/staff/deliveries/page.tsx`, `[id]/page.tsx`, `actions.ts`
- `src/components/staff/verify-delivery-form.tsx`

**Tests**
- `schedule-date.test.ts`, `schedule.authz.test.ts`, `schedule.workflow.integration.test.ts`

## 4. Supplier scheduling

- Primary CTA: **Schedule Delivery** (planned qty + planned date today/future + notes)
- Partial / multiple schedules within capacity
- Reschedule with required reason → prior `SUPERSEDED`, new `SCHEDULED`
- History shows scheduled / verified / superseded
- Does **not** bump verified qty or create GRN

## 5. Company receipt

- Staff list: upcoming/overdue schedules + legacy SUBMITTED
- **Record Receipt** / Verify & issue GRN with empty received qty + actual receipt date
- Permissions unchanged: VERIFY_DELIVERY + ISSUE_GRN (ADMIN bypass)
- Partial receipt frees shortfall for new schedule; history preserved

## 6. State / capacity

- Active holds: `SUBMITTED` + `SCHEDULED`
- `SUPERSEDED` / `VERIFIED` / `REJECTED` do not hold
- Cancel `DELIVERY_HOLD` includes SCHEDULED
- Serializable transactions + idempotency scopes for schedule/reschedule/verify

## 7. Tests

| Suite | Result |
| --- | --- |
| schedule workflow Neon (10→verify 6→schedule 4→verify 4) | PASS |
| schedule authz / date unit | PASS |
| submit/verify authz + idempotency-client | PASS |

Browser UAT: **not executed** in this session (no authenticated browser run). Manual steps below.

## 8. Remaining blockers

- Authenticated browser UAT still required on development
- Production migration not approved
- Optional: rename rehearsal child branches for clarity (cosmetic)

## 9. Manual browser testing steps

1. Supplier login → confirmed PO with remaining qty  
2. Schedule Delivery → plan 10 for a future date → success  
3. Staff login (VERIFY_DELIVERY + ISSUE_GRN) → Scheduled deliveries → Record Receipt  
4. Enter received 6 + past/today receipt date + discrepancy notes → Verify & issue GRN  
5. Supplier sees Partially Delivered / remaining 4  
6. Schedule remaining 4 → staff verifies 4 → PO Delivered, second GRN  
7. Confirm protected historical POs/GRNs unchanged  
