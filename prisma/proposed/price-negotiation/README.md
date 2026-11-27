# Proposed migration — Price comparison & negotiation

**Status:** APPLIED on Neon development (`br-morning-glade-b3odmb6e`) as `20261113180000_price_negotiation`.  
**Target:** Neon development only (production forbidden).  
**Same-offer FK:** rehearsed on child `br-wandering-forest-b3i65daq`, then included in development deploy.

## Inspection findings

### Already exists (reuse)

| Piece | Notes |
|---|---|
| `AvailabilityOffer.unitPrice` `Decimal(18,2)?` | Present but **unused** by availability UI/API |
| `AvailabilityOffer.currencyCode` | Present, unused in submit flow |
| `AvailabilityChange.unitPriceBefore/After` + `PRICE_CHANGED` | Append-only offer mutation history |
| `OrderItem.unitPrice` | Set on allocate by **silently copying** `offer.unitPrice` |
| `ProductOfferItem.unitPrice` | Separate product-offer flow (Phase 1 offers), not request availability |
| Audit + notifications | Reusable for negotiation events |

### Missing (requires migration)

| Need | Why existing fields are insufficient |
|---|---|
| Portal counteroffer / revise / accept thread | `AvailabilityOffer` is supplier-owned; staff must not invent supplier quotes there |
| Phone/WhatsApp staff-recorded price | No channel, attestation, evidence, or recorder fields |
| Agreement status ≠ supplier quote | Staff-recorded must **not** auto-mark supplier-confirmed |
| Unified price history across channels | `AvailabilityChange` only covers offer field edits |
| Explicit PO price selection | Allocate must bind an **agreed** quote, not silent offer copy |
| Comparison inputs | Prior quotes / last PO price are queryable once history is append-only |

### Docs note

`docs/supplier-requests-availability.md` still says price was “not modeled in 5B”; columns exist but the **product behavior** was never shipped.

## Proposed design (app + schema)

1. **Supplier availability (simple):** require `unitPrice > 0` on positive submit; omit for Not Available. Persist on `AvailabilityOffer` and append `AvailabilityChange` (`PRICE_CHANGED` / `SUBMITTED`).
2. **`PriceQuote` (append-only):** every quotation, counter, revise, staff-recorded external negotiation. Never UPDATE `unitPrice` — supersede with a new row.
3. **`PriceAgreement` (current pointer):** per company + supplier + product + optional `availabilityOfferId`; holds current status + `currentQuoteId` + optimistic `version`.
4. **Allocate:** staff selects/confirm agreed unit price; `OrderItem.unitPrice` + `priceQuoteId` + `priceAgreementStatusAtOrder` snapshot. Never rewrite confirmed PO lines.
5. **Comparison page:** company-scoped reads over live offers + `PriceQuote` + historical `OrderItem.unitPrice` (no invented history).

## App-enforced integrity (DB cannot fully express)

These require transactional checks + tests (not SQL FKs alone):

1. `PriceAgreement.currentQuoteId` must reference a `PriceQuote` with the **same** `companyId`, `supplierId`, `productId`, and `availabilityOfferId`.
2. `PriceAgreement.unitPrice` / `currencyCode` must equal `currentQuote.unitPrice` / `currencyCode`.
3. `Product.companyId` must equal quote/agreement `companyId`.
4. `OrderItem.priceQuoteId` must belong to the same company/supplier and (when set) the same `availabilityOfferId` as the line.
5. Allocate may bind only agreements in `SUPPLIER_CONFIRMED` or `STAFF_ATTESTED_AGREED` (never `QUOTED`, `COUNTER_PENDING`, `STAFF_RECORDED_UNCONFIRMED`, `DECLINED`, `SUPERSEDED`).
6. Append-only: never `UPDATE PriceQuote.unitPrice`; supersede with a new row + mark prior `SUPERSEDED`.
7. Status transitions are explicit in application code (e.g. counter → accept/revise; external → attest).
8. Confirmed PO `OrderItem.unitPrice` is immutable after `PurchaseOrder` leaves `SENT` (or once confirmed — product rule).

## Fragment / SQL corrections

1. `PriceAgreement.availabilityOfferId` is **required** with `@@unique([availabilityOfferId])`.
2. **Additive same-offer FK (approved for rehearsal → development):**  
   `PriceAgreement (currentQuoteId, availabilityOfferId) → PriceQuote (id, availabilityOfferId)`  
   via unique index `PriceQuote_id_availabilityOfferId_key`. Rejects agreement/quote offer mismatch at DB level.

## Out of scope for this migration

- Currency catalog / FX
- Changing Stage 5B reserve rules
- Delivery / GRN
- Cosmo OS
- Backfilling fake historical prices

## Apply sequence (after approval)

1. Review SQL + Prisma fragment.
2. Apply on Neon **development** only (`prisma migrate deploy` or approved path).
3. `prisma generate`.
4. Implement availability price field, comparison UI, negotiation APIs, allocate binding.
5. Tests: authz, isolation, concurrency on agreement version, no PO overwrite.

## Rollback

See `rollback.sql` (drops new objects only; does not touch existing confirmed POs or offer rows).
