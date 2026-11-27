# Phase F2 — Migration final review (stop for approval)

## 1. Final proposed Prisma schema diff

### OsfImportLine (amend)

```prisma
@@unique([id, companyId])                       // approved
@@unique([id, osfImportId, companyId])          // approved
@@unique([id, osfImportId, companyId, lineKey]) // hardening: bind denormalized lineKey
requestSuggestions OsfRequestSuggestion[]
```

### Supplier (amend)

```prisma
/// Cosmo OS Supplier.id (cuid). Never name-matched.
externalId String?
@@unique([companyId, externalId]) // NULLs distinct in PostgreSQL
osfRequestSuggestions OsfRequestSuggestion[]
```

### New: `OsfRequestSuggestion` + enum

See `schema.prisma.fragment` (quad FK to line; company-scoped supplier FK; positive qty CHECK; mapping/supplier consistency CHECK).

## 2. Complete migration SQL

Updated review-only files:

| File | Role |
| --- | --- |
| `migration.sql` | Forward (additive) |
| `rollback.sql` | Reverse |
| `schema.prisma.fragment` | Prisma merge target |
| `BASELINE-READONLY.md` | Dev inventory |
| `REHEARSAL-CHECKLIST.md` | Child-branch apply plan |

**SQL review verdict:** Matches approved uniques + externalId unique; adds quad line FK (required to prevent lineId/lineKey split-brain). No destructive DML. No PO changes.

## 3. Read-only safety report

See `BASELINE-READONLY.md`. Summary: branch `br-morning-glade-b3odmb6e`; 0 non-null externalIds; 12 lines consistent; F2 objects absent; protected PO CONFIRMED; Phase B is latest migration.

## 4. Rehearsal execution checklist

See `REHEARSAL-CHECKLIST.md`. **Not executed.**

## 5. Contract compatibility (`cosmo-osf-push.v1`)

| Case | Assessment |
| --- | --- |
| Payload without `requestSuggestions` | Compatible — treat as `[]`; no suggestion rows |
| Duplicate `(lineKey, cosmoSupplierId)` | Reject at Zod/parse |
| Invalid `lineKey` | Reject — must reference `items[]` |
| Zero / negative qty | Reject (`gt(0)` + DB CHECK) |
| Canonical hash | Must include sorted suggestions; omit ≡ empty for old clients |
| Same key, changed suggestions | Idempotency conflict via payloadHash |
| Supplier resolve | `(companyId, externalId=cosmoSupplierId)` only; never name |
| Unresolved suppliers | Persist `UNRESOLVED_SUPPLIER`; never drop |
| Over-line sum | Accept + `warningFlags.overLineQty` (approved soft path) |
| Side effects | No SupplierRequest / PO on ingest |

## 6. F1 regression / distribution compatibility

### Explicit recipients model

```ts
recipients: Array<{
  supplierId: string;
  name: string;
  items: Array<{ requirementItemId: string; quantityRequested: Decimal }>;
}>
```

| Scenario | Behavior |
| --- | --- |
| F1 manual distribute | Build recipients from eligible suppliers; each `items` = all requirement lines @ planned (or shared override map expanded per supplier) |
| Shared quantity overrides | Expand override map into every included recipient’s `items` (same qty each) — preserves F1 semantics |
| Supplier-specific suggestions | Different `items[].quantityRequested` per supplier |
| Item-level Ignore | Omit that `requirementItemId` from that supplier’s `items` |
| Supplier-level Ignore | Omit supplier from `recipients` entirely |
| No fallback | **Never** use `?? planned` for absent suppliers/items |
| Empty `items` | Do not create `SupplierRequest` for that supplier |
| Ledger / idempotency | Unchanged `OsfImportDistribution` + wizard keys |
| Audit / notifications | Still only inside successful create txn via `distributeRequirementInTransaction` |

**Risk:** Internal signature change of `distributeRequirementInTransaction` — mitigate with adapter helper `recipientsFromPlanned(…)` for manual path + gated F1 regression tests before ship.

## 7. Remaining blockers

1. **Approve hardening** unique `(id, osfImportId, companyId, lineKey)` + quad FK (beyond original two uniques).
2. **Approve** mapping/supplier CHECK constraints in SQL.
3. **Explicit authorization** to create disposable child branch and apply `migration.sql` there.
4. After child pass: authorize copy into `prisma/migrations/` + apply to development parent.
5. Production apply: separately forbidden until asked.
6. Application code (Zod/ingest/distribute/wizard) still not started — migration-only gate first.
7. Phase G / Cosmo client emit of suggestions — out of scope.
8. Browser UAT still pending.
