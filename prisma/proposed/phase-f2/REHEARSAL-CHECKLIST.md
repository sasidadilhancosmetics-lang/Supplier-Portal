# Phase F2 — Rehearsal execution checklist

**Do not run until migration apply is explicitly approved.**  
This checklist is preparation only.

## 0. Preconditions

- [ ] Architecture + this final SQL review approved
- [ ] Working against Neon **development** parent `br-morning-glade-b3odmb6e`
- [ ] Confirm `NEON_BRANCH_ID` ≠ `br-fancy-voice-b33wenqw`
- [ ] Snapshot recorded in `BASELINE-READONLY.md` still matches (re-run read-only script if stale)

## 1. Create disposable child branch

- [ ] Create child from development (schema+data or schema-only with seed — prefer data copy for FK drills)
- [ ] Point a temporary `DATABASE_URL` / unpooled URL at the **child only**
- [ ] Record child branch id in this checklist: `________________`

## 2. Apply proposed SQL on child only

- [ ] Apply `prisma/proposed/phase-f2/migration.sql` via unpooled connection inside one session
- [ ] Confirm transaction committed
- [ ] **Do not** copy into `prisma/migrations/` yet
- [ ] **Do not** run against development parent or production

## 3. Verify schema on child

- [ ] `\d "OsfRequestSuggestion"` — columns, CHECKs, FKs present
- [ ] Enum `OsfRequestSuggestionMappingStatus` has 4 values
- [ ] Indexes:
  - [ ] `OsfImportLine_id_companyId_key`
  - [ ] `OsfImportLine_id_osfImportId_companyId_key`
  - [ ] `OsfImportLine_id_osfImportId_companyId_lineKey_key`
  - [ ] `Supplier_companyId_externalId_key`
- [ ] `prisma migrate diff` (or `db pull` compare) shows no unexpected drift vs fragment

## 4. Integrity drills (child)

- [ ] Insert suggestion with wrong `companyId` for line → **fails**
- [ ] Insert suggestion with `osfImportLineId` from another import → **fails**
- [ ] Insert suggestion with mismatched `lineKey` for that line id → **fails**
- [ ] Insert suggestion with cross-company `supplierId` → **fails**
- [ ] Insert `suggestedRequestQty = 0` → **fails** CHECK
- [ ] Insert duplicate `(osfImportId, osfImportLineId, cosmoSupplierId)` → **fails**
- [ ] Insert two suppliers with `externalId` NULL → **succeeds**
- [ ] Insert two suppliers same `(companyId, externalId)` non-null → **fails**
- [ ] Valid MATCHED row with supplier → **succeeds**
- [ ] UNRESOLVED with `supplierId` set → **fails** mapping CHECK

## 5. Data preservation

- [ ] Supplier count unchanged (except intentional drill inserts cleaned up)
- [ ] OsfImportLine count unchanged
- [ ] `PO-20261112-E5D42983` still `CONFIRMED`
- [ ] PurchaseOrder count unchanged aside from protected row

## 6. Rollback drill

- [ ] Apply `rollback.sql` on child
- [ ] Confirm table/enum/new indexes gone
- [ ] Confirm Supplier/OsfImportLine/PO data intact
- [ ] Optionally re-apply forward SQL once to prove idempotent rehearsal path

## 7. After successful child rehearsal (approval gate)

- [ ] Copy SQL into dated `prisma/migrations/…_phase_f2_request_suggestions/`
- [ ] Merge Prisma fragment into `schema.prisma`
- [ ] Explicit approval to apply on **development parent**
- [ ] Still never production without separate approval

## Recovery if child apply fails mid-transaction

Forward SQL is wrapped in `BEGIN`/`COMMIT`. On error, Postgres aborts the transaction → **no partial objects**. Fix SQL, recreate child if needed, retry.
