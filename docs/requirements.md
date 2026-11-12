# Requirements

Recorded from the foundation brief. Items below are requirements to implement later, not behavior this repository already has. Where the brief does not specify a rule, it is listed under Unresolved and is not assumed.

## Goal

Build a secure, mobile-responsive supplier procurement portal integrated with an existing Cosmo OS / OSF process and, later, ERP.

Phase 1 stack: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, and Neon.

## Users

- Company Admin
- Company Staff, with permission-based actions
- Supplier, with extremely simple, mobile-first workflows

## Main workflow

1. Cosmo OS / OSF pushes items and quantities.
2. A draft requirement is created.
3. Staff review and confirm the requirement.
4. Requests are sent to matching suppliers, either all matching suppliers or a selected set.
5. Suppliers respond with item availability, quantity, date, and price.
6. The company allocates and orders.
7. The supplier confirms the entire order.
8. Deliveries may be partial or complete, and there may be more than one delivery.
9. Staff verify the delivery and create an immutable goods received note (GRN).
10. ERP stock posting stays manual in Phase 1.

## Phase 1

### Suppliers and brands

- Suppliers may self-register or be added by an admin.
- Supplier profiles include brands.
- A supplier and an admin can edit supplier company details without admin approval.
- A brand with an active request cannot be removed until that request is canceled or delivered.

### Requests and responses

- Requests are brand-specific.
- A supplier can respond to multiple items on one screen.
- Each item can have its own date.
- A supplier can mark an item Not Available.
- Bulk Not Available and bulk date actions are required.
- Responses support autosaved drafts and partial submission.
- Request statuses are New, Partially Responded, and Responded.

### Availability, reserve, and ordering

- Suppliers determine their available quantities.
- Staff cannot fabricate supplier availability.
- Supplier availability is reserved for the company for seven days.
- A partial order leaves the remaining quantity under the original reserve window.
- Suppliers can decrease availability, and the company is notified.
- A decrease below confirmed quantities triggers a warning. It is not a hard block.
- The company may order more than initially planned. Accounting and availability rules for that case are not fully specified (see Unresolved).

### Cancellation

- Supplier cancellation immediately cancels the relevant confirmed or reserved set.
- A reason is required.
- The company is notified and may re-request from the same or different suppliers.
- Repeated cancellations require manual handling. The threshold and the handling process are not specified.

### Orders, deliveries, and GRN

- Track dates, quantities, changes, and actors across workflow steps.
- Supplier order confirmation supports confirming an entire order in one action.
- Deliveries may be partial and multiple.
- Staff verification is required before a GRN.
- A GRN is immutable once issued.

### Supplier product offers

- Offers are in Phase 1.
- A supplier can offer existing or new products.
- Entry is multi-item and mobile-friendly.
- Staff mark Interested or Not Interested.
- The supplier reconfirms.
- An offer can become an order.
- An offer is valid for seven days.

### Dashboards and reporting

- Admin, Staff, and Supplier dashboards.
- Each dashboard has relevant alerts, summary cards, quick actions, search, notifications, date filters, and reporting.
- The supplier dashboard prioritizes upcoming deliveries, near-deadline alerts, recent availability, and simple quick actions.

### Supplier performance

Implement only after core transactions are stable.

- Scoring window: 90 days.
- Score: 60% on-time delivered quantity + 40% completed orders.
- Quantity-based cancellation penalty up to 20 points.
- Approved exceptions are supported. Who approves them is not specified.
- Ranking requires a minimum of 3 completed orders.
- No confirmed orders means the score is N/A.
- Preserve the original expected delivery date for scoring.

### Security and correctness

- Staff actions must honor permissions.
- Important changes keep an audit trail.
- Protect against duplicate requests, race conditions, overselling, over-allocation, and retries with transactions and idempotency.

## Phase 2 — do not implement now

- Direct ERP stock posting
- Complex analytics
- Advanced follow-ups
- Custom roles
- Catalog management

## Engineering constraints

- Simple modular architecture, strong TypeScript types, server-side authorization, and Zod validation on untrusted input.
- Prisma transactions for critical state changes.
- Secrets stay in environment variables and never reach the browser. Database credentials and privileged integration secrets are server-only.
- Schema changes go through migrations. Seed data is non-sensitive demo data only.
- Development and production environments stay separate.
- A UI mock is not a working backend. Do not silently substitute fake data for a completed feature.
- UI is accessible and responsive. Supplier flows use as few steps and fields as possible.
- Business logic and critical workflow transitions need tests before a module is called complete.
- Cosmo OS / OSF and ERP contracts are not confirmed. Future work uses documented adapters. Development-only mocks must be labeled as such. Do not invent API contracts.

## Unresolved

These details change data model, permissions, or integration behavior. They are not decided in this foundation.

- Cosmo OS / OSF payload shape, authentication, push vs pull, and idempotency key.
- Which ERP is in use, and what "manual stock posting" means operationally in Phase 1.
- ~~Whether the portal is single-company or multi-company.~~ **Decided (Stage 2A):** single purchasing company; many suppliers.
- How supplier users map to a supplier company when multiple logins exist. **Partially decided (Stage 2A):** multiple users per supplier, scoped by `supplierId`. Auth library still open.
- The staff permission list and which actions each permission allows (`StaffPermissionCode` is provisional in the schema).
- How a supplier or brand "matches" a request.
- ~~Whether supplier self-registration is active immediately or waits for a review.~~ **Decided (Stage 4C):** self-registration starts in `PENDING_REVIEW`; ADMIN must approve (`ACTIVE`) or reject (`REJECTED`). Profile edits after activation do not need approval.
- Seven-day reserve and seven-day offer validity: clock start, timezone, and whether the window is 7×24 hours or calendar days.
- What "order more than initially planned" must record, and where the extra quantity is allowed to come from.
- What count of cancellations becomes "repeated," and what manual handling consists of.
- How an immutable GRN is corrected if staff verification was wrong.
- Notification channels (in-app, email, or both) and who receives each event.
- Currency, tax, unit of measure, and price precision.
- Whether "existing products" in offers refers to a portal catalog. Catalog management is Phase 2, so the Phase 1 source of existing products is unclear.
- Authentication method, session length, and how supplier users relate to a supplier company.
