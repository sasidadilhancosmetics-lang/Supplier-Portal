---
name: supplier-portal-architecture
description: >-
  Supplier Portal domain architecture and confirmed business rules (availability,
  price negotiation, PO allocate/confirm/cancel, delivery scheduling, company
  receipt verification, GRN). Use when designing features, planning stages,
  implementing requirements/requests/orders/deliveries, or clarifying confirmed
  vs unresolved decisions. Read linked docs before coding; never invent unresolved rules.
---

# Supplier Portal architecture

## Before coding

1. Read the relevant canonical docs (do not restate them wholesale).
2. Treat **confirmed** rules below as binding.
3. Treat **unresolved** items as blocked until the user decides — never guess.
4. For Next.js API/file conventions, follow root `AGENTS.md` and `node_modules/next/dist/docs/` (do not edit `AGENTS.md`).

## Canonical docs

- [docs/architecture.md](../../../docs/architecture.md)
- [docs/requirements.md](../../../docs/requirements.md)
- [docs/decisions.md](../../../docs/decisions.md)
- [docs/implementation-plan.md](../../../docs/implementation-plan.md)
- [docs/requirements-management.md](../../../docs/requirements-management.md)
- [docs/supplier-requests-availability.md](../../../docs/supplier-requests-availability.md)
- [docs/orders-allocation.md](../../../docs/orders-allocation.md)
- [docs/database-design.md](../../../docs/database-design.md)

## Role split (implemented)

**Supplier does the minimum. Company handles the complexity.**

| Actor | Responsibilities |
|-------|------------------|
| **Supplier** | Respond with availability (qty, delivery date, required unit price); confirm negotiated price; confirm purchase order; schedule / reschedule deliveries |
| **Company** | Review offers and negotiate prices; create purchase orders; record actual physical receipt; verify receipt and issue GRN |

Suppliers must **never** be asked to confirm physical goods receipt. Receipt verification and GRN issuance are company-only.

## Confirmed business rules

Preserve these; do not weaken them in new work:

### Availability & price (Stage 5B+)

- Positive submit → `SUBMITTED` + **7×24h UTC** reserve from `reservedAt`. Live `SUBMITTED` updates **do not** reset/extend reserve. Fresh clock only after `EXPIRED` / `CANCELLED` / `NOT_AVAILABLE` / new positive submit.
- Response deadline ≠ reserve expiry.
- Price agreement history is append/supersede; do not invent agreed prices. PO line `unitPrice` snapshots stay immutable after allocate.

### Orders (Stage 6A)

- **Allocate:** Create `PurchaseOrder` `SENT` + lines from allocatable offers; requirement-level locks; no inventing ERP masters.
- **Confirm:** Supplier-only whole-order `SENT → CONFIRMED`; session `supplierId`; idempotency; notify + audit as implemented.
- **Cancel:** Supplier-only `SENT`/`CONFIRMED` (rules as implemented); release `quantityOrderedActive` exactly; preserve reserves; reject when active delivery holds block cancel; no auto-reallocation.

### Delivery scheduling & receipt (implemented)

- **Scheduling is not receiving.** A planned/scheduled delivery is a plan only.
- Only **company-verified** quantities count as received (`quantityVerifiedReceived`).
- Active capacity holds: `SCHEDULED` and legacy `SUBMITTED` consume remaining deliverable qty; `SUPERSEDED` (and verified/rejected) do **not**.
- Preserve original expected delivery dates on PO/lines for scoring and display.
- Company records receipt → verify → immutable GRN. Do not reopen GRN correction policy without an explicit decision.
- Preserve existing notifications, permissions, and audit trails on these transitions.

### Isolation

- Never trust client `supplierId` / `companyId`. Cross-supplier → `NOT_FOUND`.

### Still out of scope unless explicitly approved

- ERP stock posting / Cosmo ERP write-back beyond current ingest contracts
- Performance penalties / auto-scoring enforcement
- Auto-reallocation after cancel

## Unresolved (do not invent)

Examples (see `docs/requirements.md` / `docs/decisions.md`):

- Repeated-cancellation threshold and handling process
- Notification email channel (in-app model exists)
- Who approves performance exceptions
- GRN correction process after immutability
- Delivery-stage cancel interaction details beyond current hold rejection

If a task needs an unresolved decision: **stop and ask**.

## Related skills

- DB/migrations → `prisma-neon-safety`
- Auth/isolation → `auth-supplier-isolation`
- Tests/QA → `feature-dev-qa`
- UI → `ui-ux-performance`
