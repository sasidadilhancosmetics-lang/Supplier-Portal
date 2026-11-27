# Price negotiation — child-branch migration rehearsal

**Date:** 2026-11-13  
**Status:** Rehearsal complete. Development parent and production **not** migrated.

## 1. Schema safety findings

### Matched / OK
- `PriceQuote.unitPrice` / `PriceAgreement.unitPrice`: `DECIMAL(18,2)` + `CHECK (> 0)`
- Composite ownership FKs: `(supplierId, companyId)` → `Supplier`; offer/request/requestItem composite FKs
- Append-only intent: no SQL triggers; application must never `UPDATE` quote prices (supersede)
- Additive `OrderItem.priceQuoteId` / `priceAgreementStatusAtOrder` — nullable; existing null `unitPrice` rows remain valid
- No destructive SQL; no updates to existing PO/offer values in migration
- Rollback drops only new objects/columns/enums

### Correction applied before rehearsal
- **Prisma fragment vs SQL mismatch fixed:** `PriceAgreement.availabilityOfferId` is now **NOT NULL** with `@@unique([availabilityOfferId])` (SQL already had this). Fragment previously had optional + composite unique.

### Cannot be enforced by FK alone (app + tests required)
1. `PriceAgreement.currentQuote` must share the same `companyId` / `supplierId` / `productId` / `availabilityOfferId` as the agreement (DB allows offer/quote mismatch — **confirmed in rehearsal**).
2. `PriceAgreement.unitPrice` must equal `currentQuote.unitPrice`.
3. `Product.companyId` must equal quote/agreement `companyId`.
4. `OrderItem.priceQuoteId` must match the line’s offer/company/supplier when set.
5. Allocate may use only `SUPPLIER_CONFIRMED` or `STAFF_ATTESTED_AGREED` (never pending/quoted/counter/staff-unconfirmed/declined/superseded).
6. Status transition graph is application-enforced (no DB state machine CHECK).
7. Confirmed PO line `unitPrice` remains immutable in application rules.

## 2. Required SQL/schema corrections

| Item | Action |
|---|---|
| Fragment `availabilityOfferId` optional | **Fixed** to match SQL |
| Full `schema.prisma` merge | Still needs back-relations on Company/Supplier/Product/User/AvailabilityOffer/RequestItem/SupplierRequest/OrderItem before `prisma validate` on a merged file |
| CHECK constraints | Keep in SQL (not first-class Prisma); promote with migration file |

No further SQL changes required for rehearsal success.

## 3. Rehearsal branch identity

| Branch | ID | Endpoint host (non-secret) | Role |
|---|---|---|---|
| `rehearsal-price-negotiation-20261113` | `br-autumn-flower-b3z162k9` | `ep-dawn-grass-b34xmpyr…` | **Kept migrated** for review |
| `rehearsal-price-negotiation-rollback-20261113` | `br-dry-waterfall-b3nv6qfh` | `ep-misty-paper-b3wrz0w2…` | Migrate → rollback drill |
| Parent `development` | `br-morning-glade-b3odmb6e` | `ep-little-credit-b35km102…` | **Untouched** (re-verified) |
| `production` | `br-fancy-voice-b33wenqw` | — | **Not mutated** |
| Prior backups / F2 rehearsals | `br-shy-river…`, `br-muddy-forest…`, `br-hidden-cake…`, `br-calm-frog…`, `br-patient-firefly…` | — | **Not deleted** |

Parent project: `holy-art-38015209`. Children: `init_source=parent-data` from development.

## 4. Migration apply results

| Target | Result |
|---|---|
| Main rehearsal | `migration.sql` applied — **OK** |
| Rollback rehearsal | `migration.sql` then `rollback.sql` — **OK** |
| Development parent | No PriceQuote / no OrderItem.priceQuoteId; PO still CONFIRMED |

## 5. Constraint test results (main + rollback)

| Test | Result |
|---|---|
| Valid PriceQuote + PriceAgreement | PASS |
| Reject unitPrice = 0 (CHECK) | PASS |
| Reject bad/cross supplier-company pairing (FK) | PASS |
| Reject duplicate agreement per offer (UNIQUE) | PASS |
| OrderItem.priceQuoteId FK settable | PASS |
| DB allows agreement↔quote offer mismatch | **PASS (documents app check)** |
| Status transitions DB-enforced | **N/A — app enforced** |
| Existing business data preserved | PASS |
| Protected PO unchanged | PASS |
| Rollback removes new objects | PASS (rollback branch) |
| Rollback preserves offers/items/PO | PASS |

## 6. Existing business-data comparison

Parent baseline (= child before migrate):

| Metric | Value |
|---|---|
| AvailabilityOffer | 2 (all `unitPrice` NULL) |
| OrderItem | 1 (`unitPrice` NULL) |
| SupplierRequest | 3 |
| PurchaseOrder | 1 |
| `_prisma_migrations` finished | 7 (through `20261113134000_phase_f2_request_suggestions`) |
| Proposed objects present on parent | **No** |
| `PO-20261112-E5D42983` | **CONFIRMED** `version=2` |

After migrate + fixture cleanup on main rehearsal: same counts; `PriceQuote`/`PriceAgreement` fixture rows deleted (0 left).

## 7. Rollback drill result

On `br-dry-waterfall-b3nv6qfh`: after rollback, PriceQuote/PriceAgreement tables gone, enums gone, OrderItem price columns gone; offers=2, order_items=1, protected PO **CONFIRMED**.

## 8. Blockers before development migration

1. **Explicit approval** to copy SQL into `prisma/migrations/` and apply on `br-morning-glade-b3odmb6e`.
2. Merge fragment + **relation back-references** into `prisma/schema.prisma` (naive append does not `prisma validate`).
3. Implement application integrity checks/tests listed in §1 before relying on allocate/negotiation.
4. Keep main rehearsal branch until development apply is confirmed.

## Recommendation

**Approve for development apply** of the reviewed `migration.sql` (with corrected fragment) after relation merge + app-check plan, still **no production**.
