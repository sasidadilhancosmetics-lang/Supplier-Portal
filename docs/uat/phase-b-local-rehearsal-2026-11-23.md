# Phase B local rehearsal — 23 November 2026

**Result:** Local database workflow and mocked responsive browser checks passed.

- PostgreSQL 18.7, cluster `C:/dev/local-postgres18/cluster`, database `supplier_portal_phase_b_rehearsal`, bound only to `127.0.0.1:55432`. Target was initially empty.
- All 12 checked-in migrations applied and matched their ledger checksums. Phase B SHA-256 is `8a36c08c53af006b54bc0fb4fe6ab2b9a26ebe056e9d863ea364a127c194a778`.
- Verified Phase B tables, indexes and price revision trigger. Verified validated PriceAgreement composite FK on availabilityOfferId and supplierId, ON UPDATE CASCADE / ON DELETE RESTRICT. A real cross-supplier modification failed on the named constraint.
- Service tests used temporary adapter-pg 7.10.1, real service/authorization code with synthetic sessions, mocked photo transport, and savepoint-backed transactions within a rollback-only fixture transaction.
- Passed OSF ingest/replay, review/confirmation, newer draft ignored, search, explicit brands, SKU exclusion, supplier isolation, price add/update, optional MOQ, idempotency, stale revision conflict, immutable revisions, brand removal/reselection, and active-request protection.
- Passed photo mapping, missing photo, wrong SKU, wrong variant, ambiguity review, invalid source-company binding and non-Admin refresh denial. The fixture used a single destination company.
- Passed partial availability, negotiated price, allocation, confirmed PO, unchanged quote/agreement/PO snapshots after a catalogue price update, split deliveries, partial/final staff receipts, two GRNs, and derived PO delivery status.
- All 38 application tables were empty after rollback. All 12 migration entries were retained.
- Supplier Portal Vitest 430 passed, 72 hosted cases skipped, zero failed. Cosmo OS OSF/photo mock suites 7 passed, zero failed. Initial harness errors were fixed before the successful run. The test driver emitted a pg overlap deprecation warning.
- Mock browser at 320, 360, 375, 390, 430, 768 and 1280 px measured zero page overflow in catalogue, profile brand-selection control, Admin SKU exclusions, OSF review, availability and receiving. Catalogue rendered a synthetic photo and a placeholder. Enter focused the 44 px decimal price input, and Cancel returned focus. At 360 px partial search, mock save focus and supplier drawer Escape/restored focus passed.
- Browser session and action handlers were mocked. Physical devices, authenticated browser UAT, full two-company data isolation and independent-connection concurrency were not tested. No live provider, hosted database or deployment operations occurred. Odoo PostgreSQL retained the same running PID and service configuration.
