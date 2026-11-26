# Stage 6A1 — Order creation and atomic allocation

**Scope:** create `PurchaseOrder` + `OrderItem` lines from submitted availability (6A1), supplier confirmation (6A2), supplier cancellation + manual re-request (6A3).  
**Out of scope:** deliveries, GRN, ERP, auto-reallocation, performance penalties.

## Stage 6A2 — Supplier confirmation

- Routes: `/supplier/orders`, `/supplier/orders/[id]`; staff list `/staff/orders`.
- Transition: `SENT → CONFIRMED` via PO row lock + conditional `updateMany`; sets `confirmedAt`, increments `version`.
- Does **not** change quantities, offer `quantityOrderedActive`, or reserve timestamps.
- Confirmation allowed after reserve expiry (allocation already committed).
- Auth: `requireSupplier` + ownership by session `supplierId` (cross-supplier → `NOT_FOUND`).
- Idempotency scope `po.confirm:{actorUserId}` + payload hash of `{ purchaseOrderId }`.
- Notify: company ADMIN + `ALLOCATE_ORDER` STAFF + allocate actor (deduped).
- Audit: `PURCHASE_ORDER_CONFIRMED` on `PurchaseOrder`.
- **No migration** (uses existing `confirmedAt` / `CONFIRMED` status).

## Stage 6A3 — Supplier cancellation

- Supplier-only cancel of `SENT` or `CONFIRMED` (staff cannot cancel for suppliers).
- Cancels all remaining undelivered qty; preserves `quantityOrdered` and verified received.
- Rejects when `SUBMITTED` delivery holds exist (`DELIVERY_HOLD`) — no speculative delivery transitions.
- Releases `quantityOrderedActive` by cancelled amount; appends `ORDER_ALLOCATION_RELEASED`; never touches reserve clocks or reactivates `EXPIRED`/`CANCELLED` offers.
- Lock order: requirement items → offers → purchase order (compatible with 6A1).
- Idempotency scope `po.cancel:{actorUserId}` + payload `{ purchaseOrderId, cancelReason }` (reason max 500).
- Confirm vs cancel on `SENT`: first committed valid transition wins; cancel may still run after confirm.
- Uncovered demand = planned − Σ(ordered − cancelled); staff **Re-request uncovered** opens existing `/staff/requirements/[id]/distribute` (explicit send).
- **Future delivery stage must** define cancel interaction with SUBMITTED/VERIFIED deliveries (block vs reject holds).
- **No migration** (uses existing cancel fields / statuses).

## Hardening report (pre-implementation)

### 1. Requirement-level concurrency

**Problem:** Offer-only conditional updates do not stop two staff allocating *different* offers that share one `RequirementItem` from collectively exceeding `quantityPlanned` (normal / in-plan path).

**Mechanism (no schema change):**

1. Collect distinct `requirementItemId`s from selected offers.
2. `SELECT … FOR UPDATE` those `RequirementItem` rows in **sorted id order**.
3. Lock offer rows in **sorted id order**.
4. Recompute coverage (`Σ(quantityOrdered − quantityCancelled)` via RequestItem → Offer → OrderItem).
5. Enforce remaining plan (unless above-plan acknowledged).

### 2. Idempotency

`IdempotencyKey` with scope `po.allocate:{actorUserId}` (also `po.confirm:` / `po.cancel:`), payload hash in `responseJson`, claim+complete in one transaction, 30-day retention.

### 3. Audit entity type

`AuditLog.entityType` is a string — use `"PurchaseOrder"`. No migration.

See also [decisions.md](decisions.md).
