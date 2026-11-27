# Final Contract — Cosmo OS → Supplier Portal (Staff-simplified UX)

**Status:** Contract only — no code, migrations, or production changes.  
**Repos compared:** `C:\dev\cosmo-os` and `C:\dev\Supplier Portal`.

**Staff UX (approved):** One OSF Import → One Import Review screen → Brand-wise groups → One confirmation → Guided brand-routed distribution.

**Domain invariant (preserved):** Each Portal `Requirement` remains **one brand**. An import may create **N draft requirements** (one per brand); staff never have to open N separate requirement pages for the happy path.

---

## 1. Quantity and Cosmo field reuse (unchanged)

| Field | Cosmo source | In push payload |
|-------|--------------|-----------------|
| SKU | `ProductItem.sku` | Required |
| Description | `ProductItem.productTitle` | Required |
| Brand | `Vendor` → `vendorId`, `vendorName` | Required |
| ERP priority | `erp1ProductPriority` / `erp2ProductPriority` | Required for display (send both) |
| TOTAL ORDER QTY | `computeTotalOrderQtyForSkus` → items `reorderQty` | Required as `quantity.totalOrderQty` |
| Stock / ROP | Not on supplier-orders items API | Optional `snapshot` only; never recomputed in Portal |

Cosmo **must not** reimplement formulas; Portal **must not** invent OSF math. Cosmo supplier-allocation zip UI stays separate; Portal routing uses existing brand matching after confirm.

---

## 2. Conceptual model

```
OsfImport (1)
  ├── OsfImportLine[]     ← every inbound line (matched + unmatched); never silently dropped
  └── Requirement[]       ← 0..N DRAFT/CONFIRMED, one brand each, osfImportId set

Staff UI: /staff/osf-imports/[importId]   ← single Import Review
Confirm:  confirmOsfImport(importId)     ← batch over all ready brand drafts
Distribute: guided wizard on same import ← per-brand distributeRequirement under the hood
```

`RequirementItem` still requires `productId`. Unmatched lines live only on **`OsfImportLine`** until staff resolves mapping; then a draft line is created/updated. Nothing unmatched is omitted from the review screen.

---

## 3. Proposed API contract

### 3.1 Ingest (Cosmo → Portal)

`POST /api/integrations/cosmo/v1/requirement-imports`

Headers: `Authorization: Bearer <token>`, `Idempotency-Key`, `X-Contract-Version: cosmo-osf-push.v1`

Body: same `cosmo-osf-push.v1` as before (items may span multiple brands). Zero qty → line stored as `REJECTED_ZERO_QTY` (visible, not on a requirement). Duplicate SKU in payload → `422`. Company from **credential binding only**.

**Success response (updated for unified review):**

```json
{
  "contractVersion": "cosmo-osf-push.v1",
  "importId": "imp_…",
  "status": "NEEDS_REVIEW",
  "idempotencyKey": "…",
  "replay": false,
  "summary": {
    "brandCount": 3,
    "lineCount": 40,
    "matchedCount": 35,
    "unresolvedCount": 4,
    "rejectedCount": 1,
    "totalQuantityProposed": 1200
  },
  "requirements": [
    {
      "requirementId": "req_…",
      "brandId": "brand_…",
      "brandName": "Buddy Brand",
      "status": "DRAFT",
      "itemCount": 12
    }
  ],
  "deepLinkPath": "/staff/osf-imports/imp_…"
}
```

`deepLinkPath` always points to **Import Review**, not a single requirement page.

**Statuses for `OsfImport` (proposed enum extension — needs schema approval):**

| Status | Meaning |
|--------|---------|
| `RECEIVED` | Persisted, mapping not finished |
| `NEEDS_REVIEW` | Has unresolved / ambiguous lines or unknown brands |
| `READY_TO_CONFIRM` | All keepable lines mapped; every brand draft non-empty |
| `CONFIRMED` | All brand requirements confirmed |
| `FAILED` | Ingest/processing failed |
| `PROCESSED` | Deprecated alias or map to `READY_TO_CONFIRM` for backward compatibility with existing enum |

Existing schema today: `RECEIVED | PROCESSED | FAILED` only — **migration required** to add review/confirm states (or encode review state only via lines + derived API field without enum change; prefer explicit enum for clarity).

### 3.2 Import Review read model (Portal staff)

`GET /staff/osf-imports/[importId]` (page) + optional `GET /api/staff/osf-imports/[importId]` JSON for client search.

Response shape (conceptual):

```json
{
  "importId": "imp_…",
  "status": "NEEDS_REVIEW",
  "summary": {
    "brands": 3,
    "items": 40,
    "quantityPlanned": 1180,
    "issues": { "unknownSku": 3, "unknownBrand": 1, "ambiguousSku": 0, "zeroQty": 1 }
  },
  "brands": [
    {
      "brandKey": "cosmo:vnd_1",
      "brandId": "brand_…" ,
      "brandName": "Buddy Brand",
      "brandMapping": "MATCHED",
      "requirementId": "req_…",
      "requirementStatus": "DRAFT",
      "expandedByDefault": true,
      "items": [
        {
          "lineId": "line_…",
          "lineKey": "ABC_1",
          "sku": "ABC_1",
          "productName": "Serum 30ml",
          "quantityPlanned": 20,
          "erpPriority": { "erp1": "Top Priority", "erp2": null },
          "mappingStatus": "MATCHED_SKU",
          "productId": "prod_…",
          "editableQty": true,
          "resolutionActions": []
        },
        {
          "lineId": "line_…",
          "sku": "NEW_9",
          "productName": "Unknown item",
          "quantityPlanned": 5,
          "erpPriority": { "erp1": "Priority", "erp2": null },
          "mappingStatus": "UNKNOWN_SKU",
          "productId": null,
          "editableQty": true,
          "resolutionActions": ["LINK_EXISTING_PRODUCT", "CREATE_PROVISIONAL_PRODUCT", "EXCLUDE_LINE"]
        }
      ]
    }
  ]
}
```

UI rules: all brand groups **expanded by default**; global search over brand name, SKU, product name; inline qty edit; clear issue chips; sticky summary.

### 3.3 Line / brand resolution (staff mutations)

| Action | Permission | Behavior |
|--------|------------|----------|
| Update line qty | `MANAGE_REQUIREMENTS` | Updates `OsfImportLine` + linked `RequirementItem` if matched |
| Link existing product | `MANAGE_REQUIREMENTS` (+ product must same company; brand must match resolved brand) | Sets `productId`, creates/updates draft item |
| Create provisional product | `MANAGE_PRODUCTS` | Explicit staff action only; then link |
| Create brand | `MANAGE_BRANDS` | Explicit; then rematch brand group |
| Exclude line | `MANAGE_REQUIREMENTS` | Status `EXCLUDED`; remains visible; not confirmable as demand |
| Confirm import | `CONFIRM_REQUIREMENT` | Batch confirm (§3.4) |
| Guided distribute | `SEND_SUPPLIER_REQUEST` | After import `CONFIRMED` (§3.5) |

Never auto-create brand/product on ingest.

### 3.4 Batch confirm

`POST` staff action `confirmOsfImport({ importId, idempotencyKey })`

**Preconditions:**
- Import company = session company
- No lines in `UNKNOWN_*` / `AMBIGUOUS_*` / `UNKNOWN_BRAND` (unless `EXCLUDED` or `REJECTED_*`)
- Every non-excluded brand group has `brandId` + DRAFT requirement with ≥1 item
- All planned qty > 0 on included lines

**Behavior:**
- Single idempotency scope e.g. `osf.import.confirm:{actorUserId}` + `{ importId }`
- Transaction or ordered claims: for each DRAFT requirement under import, reuse existing confirm claim (`updateMany` status `DRAFT` → `CONFIRMED`)
- Partial failure: if brand B fails mid-batch, commit successful brands, return structured result; import status stays `NEEDS_REVIEW` or new `PARTIALLY_CONFIRMED` (**open:** prefer **all-or-nothing** for staff simplicity — recommend **all-or-nothing** with preflight validation so UI never mid-fails)

**Recommended:** preflight validate all brands → one transaction confirms all → `OsfImport.status = CONFIRMED`. No partial confirm in v1.

**Response:**

```json
{
  "importId": "imp_…",
  "status": "CONFIRMED",
  "confirmedRequirementIds": ["req_a", "req_b"],
  "already": false,
  "nextStepPath": "/staff/osf-imports/imp_…/distribute"
}
```

### 3.5 Guided distribution (one workflow, brand-routed)

`GET …/distribute` wizard data: per confirmed requirement, matching suppliers via existing `filterMatchingSuppliers(brandId)`.

`POST distributeOsfImport({ importId, mode, selectionsByRequirementId, idempotencyKey })`

- Internally calls existing `distributeRequirement` **per brand requirement**
- UI is one wizard: progress by brand; staff picks ALL_MATCHING or SELECTED per brand (defaults can mirror today’s distribute UX)
- Partial failure allowed here: brand A sent, brand B fails → report `{ succeeded: [...], failed: [{ brand, code, message }] }`; retry failed brands with new or same idempotency keys per requirement (reuse request distribute idempotency if present; else document per-requirement keys)

Staff never need to open `/staff/requirements/[id]/distribute` for the import happy path (those pages remain for manual requirements).

---

## 4. Authentication and company mapping

Unchanged from prior contract:

- Portal-issued Bearer token → `{ portalCompanyId, cosmoCompanyId }`
- Body `source.cosmoCompanyId` must match binding; writes use **portalCompanyId only**
- Deep link returned to Cosmo: `{PORTAL_ORIGIN}{deepLinkPath}` (Import Review)

---

## 5. Product / brand mapping rules (final)

| Case | Ingest | Import Review |
|------|--------|----------------|
| Exact unique SKU + brand match | `MATCHED_SKU`; draft item created | Editable qty |
| Ambiguous SKU | `AMBIGUOUS_SKU`; no draft item | Staff must link one product |
| Unknown SKU | `UNKNOWN_SKU`; line kept | Link / create provisional / exclude |
| Unknown brand | `UNKNOWN_BRAND`; no requirement for group | Create brand (explicit) then rematch |
| Duplicate SKU in payload | Reject entire ingest `422` | — |
| Zero qty | Line `REJECTED_ZERO_QTY` | Visible in summary; not confirmable |
| Invalid qty | Line rejected / ingest 422 if structural | — |
| Retry same key | Replay; same `importId` + review URL | — |
| Changed snapshot | New key → new import | Old import untouched |

Cosmo ERP priority strings are **display/snapshot fields** on the line. Do not silently map them onto Portal `ProductPriorityStatus` (`NORMAL|HIGH|CRITICAL`) without a separate approved mapping table.

---

## 6. Idempotency and retries

| Operation | Key |
|-----------|-----|
| Cosmo push | `Idempotency-Key` = body key; `OsfImport` unique `(companyId, idempotencyKey)`; store payload hash |
| Confirm import | `osf.import.confirm:{actor}` + `importId` |
| Distribute per brand | Prefer existing distribute idempotency if any; else `osf.import.distribute:{actor}` + `importId` + `requirementId` |

Cosmo HTTP retries: same key on 5xx/network. Timeout 30–60s.

---

## 7. UX flow (final)

**Cosmo**

1. Supplier Orders → select lines (TOTAL ORDER QTY from existing API)  
2. Send to Supplier Portal  
3. Success → **Open import review** (not per-brand requirement)

**Portal Import Review** (`/staff/osf-imports/[id]`)

1. Summary: brands, items, qty, issues  
2. All brands expanded; items under each heading  
3. Search; edit qty; resolve unknown/ambiguous inline  
4. **Confirm all** (disabled until issues cleared or excluded)  
5. **Distribute** guided wizard → brand-routed supplier requests  

Responsive: sticky summary + virtualized lists if line count is large (implementation detail; contract requires “efficient for large imports”).

---

## 8. Proposed schema changes (approval required — do not migrate yet)

### Required for this UX

1. **`OsfImportStatus`** — add `NEEDS_REVIEW`, `READY_TO_CONFIRM`, `CONFIRMED` (keep `RECEIVED`, `FAILED`; redefine or retire `PROCESSED`).
2. **`OsfImportLine`** (new) — company-scoped lines for every inbound row:

```text
id, osfImportId, companyId
lineKey, sku, descriptionSnapshot
cosmoVendorId, brandNameSnapshot
brandId? (null if unknown brand)
productId? (null if unmatched)
requirementId? / requirementItemId?
quantityPlanned Decimal
erp1Priority?, erp2Priority? String?
mappingStatus enum (MATCHED_SKU|UNKNOWN_SKU|AMBIGUOUS_SKU|UNKNOWN_BRAND|REJECTED_ZERO_QTY|EXCLUDED|…)
resolutionNotes?
payload fragment / raw optional Json
@@unique([osfImportId, lineKey])
```

3. **`OsfImport.payloadHash`** String — idempotency conflict detection.  
4. **`IntegrationCredential`** (or env single-tenant v1) — `tokenHash`, `companyId`, `cosmoCompanyId`, `isActive`.

### Optional later

- `Brand.externalCosmoVendorId` unique per company  
- `Product.sku` unique per `(companyId, sku)` where sku not null (data cleanup first)  
- Import-level audit events `OSF_IMPORT_CONFIRMED`, `OSF_IMPORT_DISTRIBUTED`

### Existing to reuse (no change required for core model)

- `OsfImport` ↔ `Requirement.osfImportId` (already 1:N)  
- `Requirement` one `brandId`  
- `createDraftRequirementForCompany`, `confirmRequirement` claim pattern, `distributeRequirement`  
- `RequirementItem.externalLineId` ← store Cosmo `lineKey`/`sku`

---

## 9. Authorization

| Step | Permission |
|------|------------|
| Ingest | Integration credential |
| View import review | Same as requirement read: `MANAGE_REQUIREMENTS` \| `CONFIRM_REQUIREMENT` \| `SEND_SUPPLIER_REQUEST` |
| Edit qty / map / exclude | `MANAGE_REQUIREMENTS` |
| Create product / brand | `MANAGE_PRODUCTS` / `MANAGE_BRANDS` |
| Confirm import | `CONFIRM_REQUIREMENT` |
| Distribute wizard | `SEND_SUPPLIER_REQUEST` |

ADMIN bypass unchanged. Deny by default.

---

## 10. Required changes per repository

### Cosmo OS
- Portal client + env secrets  
- Admin `Send to Supplier Portal` on Supplier Orders (selected rows; qty via `computeTotalOrderQtyForSkus`)  
- Include ERP priorities on snapshot lines  
- Success UI → open **import review** deep link  
- Optional send audit table  

### Supplier Portal
- Ingest API + credential binding  
- Persist `OsfImport` + `OsfImportLine` + per-brand drafts for matched lines  
- Import Review UI (single page)  
- Batch confirm + guided distribute orchestration  
- No silent omit; no auto-map invent  

---

## 11. Open decisions (narrowed — recommend defaults)

| # | Topic | **Recommended default** |
|---|--------|-------------------------|
| 1 | Confirm partial failure | **All-or-nothing** after preflight |
| 2 | Distribute partial failure | **Allowed** per brand with retry |
| 3 | Zero-qty lines | Store visible as rejected; exclude from confirm |
| 4 | Unknown brand | Block confirm until brand created + rematched, or exclude whole brand group |
| 5 | Stock/ROP on payload | Omit in v1 |
| 6 | Credentials | Schema `IntegrationCredential` (dev first); no production |
| 7 | `PROCESSED` enum | Migrate → `READY_TO_CONFIRM` / keep mapping in code briefly |
| 8 | Exclude vs delete unmatched | **Exclude** (audit-friendly) |
| 9 | Cosmo allocations → Portal suppliers | **Out of scope**; Portal matching only |

---

## 12. Implementation plan (for approval)

| Phase | Work | Gate |
|-------|------|------|
| **A. Contract lock** | Approve this doc + §11 defaults | No code |
| **B. Portal schema** | Migration: statuses, `OsfImportLine`, `payloadHash`, credentials (explicit approval) | Neon **dev only** |
| **C. Portal ingest** | Auth, idempotency, line persist, matched drafts, deep link | Tests: authz, idempotency, multi-brand, no auto-create |
| **D. Import Review UI** | One page, brand groups expanded, search, qty edit, resolution actions, summary | a11y, mobile, large-list performance |
| **E. Batch confirm** | Preflight + all-or-nothing confirm; idempotency; audit | Authz + concurrency tests |
| **F. Guided distribute** | Wizard wrapping per-brand `distributeRequirement`; partial fail report | Authz + matching accuracy |
| **G. Cosmo send** | Snapshot + button + deep link to import review | RBAC; reuse TOTAL ORDER QTY only |
| **H. Hardening** | Metrics, key rotation, load with large imports | Dev UAT sign-off |

**Explicitly not in this track:** deliveries, Cosmo ERP credentials to Portal, Vault OSF, auto product/brand create on ingest, Phase B UX home queues (separate).

---

## Stop for approval

Please approve:

1. Unified Import Review as the only staff deep link from Cosmo  
2. Multi-requirement backend + single confirm/distribute orchestration  
3. Schema additions in §8 (especially `OsfImportLine` + status enum)  
4. Defaults in §11  
5. Implementation sequence §12 (B→H), migrations only after your explicit go-ahead  

No implementation until you approve.