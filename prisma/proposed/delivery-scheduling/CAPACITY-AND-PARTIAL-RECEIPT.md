# Capacity and partial-receipt design (app rules)

Schema holds structure; **quantity safety is application + transaction locks** (same pattern as current submit/verify).

## Active capacity formula (post-cutover)

```text
openOrdered = quantityOrdered - quantityCancelled

activeHold = sum(DeliveryItem.quantityDelivered)
             where Delivery.status IN ('SUBMITTED', 'SCHEDULED')
             for that orderItemId

activeHold + quantityVerifiedReceived <= openOrdered
```

| Status | Counts as active hold? | Counts as received? |
| --- | --- | --- |
| `SUBMITTED` (legacy) | Yes | No |
| `SCHEDULED` | Yes | No |
| `VERIFIED` | No (received via `quantityVerifiedReceived`) | Yes |
| `REJECTED` | No | No |
| `SUPERSEDED` | No | No |

## Scheduling must NOT

- Increment `OrderItem.quantityVerifiedReceived`
- Insert `Grn` / `GrnItem`
- Set PO to `PARTIALLY_DELIVERED` / `DELIVERED`
- Treat `plannedDeliveryAt` as receipt (`receivedAt` is distinct)

## Partial receipt (close without losing history)

Example: schedule 10 → company verifies received 6.

1. Keep the original `SCHEDULED` row’s `DeliveryItem.quantityDelivered = 10` (planned history).
2. In the verify transaction: set status `VERIFIED`, set `receivedAt`, issue GRN for **6**, increment `quantityVerifiedReceived` by **6**, append discrepancy notes.
3. Active hold of 10 ends because status is no longer `SCHEDULED`/`SUBMITTED`.
4. Remaining deliverable becomes `openOrdered - verified - other_holds` (includes the shortfall 4).
5. Supplier creates a **new** `SCHEDULED` delivery for up to 4 — do **not** UPDATE the verified row’s quantities.

Do **not** use `SUPERSEDED` for partial receipt. `SUPERSEDED` is only for **reschedule before receipt** (replace plan; prior row kept for audit).

## Reschedule before receipt

1. Lock PO + order lines.
2. Insert new `SCHEDULED` with `supersedesDeliveryId` + `rescheduleReason`.
3. Set prior row `SCHEDULED` → `SUPERSEDED` (same transaction).
4. Capacity: prior hold released; new hold applied; net must still fit remaining.

DB enforces same `purchaseOrderId` via composite FK. App also enforces: prior is `SCHEDULED` (or legacy unreleased `SUBMITTED` if product allows), same supplier/company session scope, no supersede of `VERIFIED`/`REJECTED`/GRN-backed rows.

## Concurrency

- Same locks as today: PO → delivery → order items (sorted ids).
- Idempotency on schedule create / reschedule / verify.
- Conditional capacity check after locks; reject over-allocate.
- Verify still refuses received > planned line qty and received that would exceed open ordered.

## Cancel vs holds

- Existing rule: cannot cancel into qty held by active `SUBMITTED` (extend to `SCHEDULED`).
- Options unchanged: reject cancel with `DELIVERY_HOLD`, or explicitly resolve holds in-product later — do not invent Stage 7 cancel behavior here.
