# Phase F2 — Rehearsal & automated test plan (REVIEW ONLY)

## Disposable branch rehearsal

1. Create a **schema-only or data-copy child** of `br-morning-glade-b3odmb6e` (never production).
2. Apply `migration.sql` inside a transaction on that child only.
3. Verify:
   - Triple FK rejects suggestion whose `osfImportLineId` belongs to another import.
   - Cross-company `supplierId` rejected by `(supplierId, companyId)` FK.
   - Duplicate `(osfImportId, osfImportLineId, cosmoSupplierId)` rejected.
   - `suggestedRequestQty <= 0` rejected by CHECK.
   - `Supplier` insert with duplicate `(companyId, externalId)` rejected; multiple NULL `externalId` allowed.
4. Run `rollback.sql` on the child; confirm tables/enums/indexes removed.
5. Only after sign-off: propose moving SQL into `prisma/migrations/` and apply to development.

## Automated integration tests (post-implement)

| Area | Cases |
| --- | --- |
| Ingest Zod | omit suggestions; valid multi-supplier; bad lineKey; qty≤0; duplicate pair; hash stability; same-key changed suggestions → conflict |
| Ingest DB | persist MATCHED / UNRESOLVED; preserve unresolved; no SupplierRequest; no PO; `quantityProposed` unchanged |
| Mapping | resolve by `externalId` only; never name; INELIGIBLE_BRAND; NOT_FOUND cross-company |
| Quantity routing | included A:60 B:30; ignored never gets fallback; manual uses planned; removed item omitted; planned unchanged |
| F1 ledger | SUCCEEDED not resent; SKIPPED intact; retryFailedOnly; audit/notification counts |
| Manual distribute | regression unchanged |

## Protected PO

Assert `PO-20261112-E5D42983` remains `CONFIRMED` and fixture company creates zero POs.
