# Phase F2 — Schema & migration pack (REVIEW ONLY)

**Do not apply** to development or production until explicitly approved.  
Not under `prisma/migrations/`.

## Files

| File | Purpose |
| --- | --- |
| `FINAL-REVIEW.md` | Migration review deliverable (start here) |
| `schema.prisma.fragment` | Final Prisma diff fragment |
| `migration.sql` | Complete forward SQL |
| `rollback.sql` | Reverse SQL |
| `BASELINE-READONLY.md` | Read-only Neon development inventory |
| `REHEARSAL-CHECKLIST.md` | Disposable child-branch apply checklist |
| `rehearsal-test-plan.md` | Earlier test outline (still valid) |

## Approved decisions reflected

1. `OsfImportLine` uniques `(id, companyId)` and `(id, osfImportId, companyId)`
2. Reuse `Supplier.externalId` = Cosmo Supplier.id
3. Unique `(companyId, externalId)` with multiple NULLs allowed
4. Soft over-line at ingest (application `warningFlags`; qty still `> 0`)
5. Distribution moves to explicit per-supplier `items[]` (app layer; not SQL)

## Hardening added in final SQL (needs ack)

- Unique `(id, osfImportId, companyId, lineKey)` + quad FK so `lineKey` cannot drift from `osfImportLineId`
- CHECK linking `mappingStatus` ↔ `supplierId` presence
