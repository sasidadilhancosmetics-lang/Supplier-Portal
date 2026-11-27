# Cosmo OS → Supplier Portal — Integration Contract (v0 for approval)

Both repos were compared (`C:\dev\cosmo-os` + `C:\dev\Supplier Portal`). **No application code, schema, or production changes were made.**

**Direction (approved):** Cosmo secure push → Portal `OsfImport` → Draft Requirement → staff review → confirm → existing supplier requests.

**Quantity rule (binding):** Cosmo must call existing `computeTotalOrderQtyForSkus` (`lib/osf/supplier-orders-reorder.ts`). Portal must **not** reimplement OSF formulas.

---

## Confirmed Cosmo fields (supplier-orders path)

| Need | Available today | Source |
|------|-----------------|--------|
| SKU | Yes | `ProductItem.sku` → items API `sku` |
| Description | Yes | `ProductItem.productTitle` → `description` |
| Brand / Vendor | Yes | `vendorId`, `vendorName` (`Vendor`) |
| ERP priority | Yes (filter/context) | `erp1ProductPriority` / `erp2ProductPriority` (not on items JSON today; loadable from same `ProductItem`) |
| TOTAL ORDER QTY | Yes | `reorderQty` = `computeTotalOrderQtyForSkus` |
| Stock / ROP | **Not** on `/supplier-orders/items` | Live via OSF columns + ERP bins + `ProductOsfRop`; workbook computes totals. Treat as **optional v1.1 enrichment**, not required for draft qty |

No stable OSF run id exists. Identity for a send = Cosmo-generated `idempotencyKey` + snapshot.

---

## Cross-repo constraints (real schema)

| Concern | Cosmo OS | Supplier Portal |
|---------|----------|-----------------|
| Tenant | `companyId` on session user | `Company.id`; never trust body `companyId` alone |
| Brand | `Vendor` | `Brand` `@@unique([companyId, name])` |
| Product | `ProductItem` (location-scoped; OSF dedupes by SKU) | `Product` — `sku` **nullable, not unique** |
| Requirement | N/A | **One `brandId` per requirement** |
| Import | None outbound | `OsfImport` + `@@unique([companyId, idempotencyKey])`, status `RECEIVED` / `PROCESSED` / `FAILED` |
| Draft API | N/A | `createDraftRequirementForCompany` (qty **> 0**, unique product per draft, brand-scoped products) |
| Auth today | Session RBAC for OSF; merchant `X-API-Key` elsewhere (not OSF) | Auth0 users; **no** Cosmo ingest API yet |

---

## 1. Proposed API contract

### Endpoint (Portal)

`POST /api/integrations/cosmo/v1/requirement-imports`

- Content-Type: `application/json`
- Auth: see §3
- Header: `Idempotency-Key: <string>` (required; must equal body `idempotencyKey`)
- Header: `X-Contract-Version: cosmo-osf-push.v1`

### Payload `cosmo-osf-push.v1`

```ts
{
  contractVersion: "cosmo-osf-push.v1";
  idempotencyKey: string;           // 8–128 chars, opaque
  source: {
    system: "cosmo-os";
    cosmoCompanyId: string;         // Cosmo tenant id (informational; not trusted alone)
    sentAt: string;                 // ISO-8601
    asOfDate?: string;              // YYYY-MM-DD
    osfVariant?: "main" | "vat" | "non_vat";
    salesMonth?: string;            // YYYY-MM
    actorUserId?: string;           // Cosmo user who clicked Send
    actorEmail?: string;
  };
  selection: {
    mode: "SUPPLIER_ORDERS_SELECTION";
    brandFilter?: { cosmoVendorId?: string; name?: string };
    priorityFilter?: string;        // ERP priority string used in UI
  };
  items: Array<{
    lineKey: string;                // stable within payload; recommend sku
    sku: string;                    // required
    description: string;            // required (may be "")
    barcode?: string;
    brand: {
      cosmoVendorId: string;        // required
      name: string;                 // required
    };
    priorities?: {
      erp1?: string | null;
      erp2?: string | null;
    };
    quantity: {
      totalOrderQty: number;        // required; integer ≥ 0; from computeTotalOrderQtyForSkus
    };
    snapshot?: {                    // optional enrichment
      totalStock?: number;
      totalRop?: number;
    };
    hints?: {
      latestSupplierName?: string;
    };
  }>; // 1..500
}
```

**Required:** `contractVersion`, `idempotencyKey`, `source.system`, `source.cosmoCompanyId`, `source.sentAt`, `selection.mode`, `items[]` with `lineKey`, `sku`, `description`, `brand.cosmoVendorId`, `brand.name`, `quantity.totalOrderQty`.

**Explicitly out of v1:** per-warehouse breakdown, full OSF workbook, Cosmo `Supplier.id` as routing, pricing/margin grids, Vault OSF.

### Response shapes

**`201 Created` / `200 OK` (idempotent replay)** — import accepted; draft created or same prior result returned:

```json
{
  "contractVersion": "cosmo-osf-push.v1",
  "importId": "osf_imp_…",
  "status": "PROCESSED",
  "idempotencyKey": "…",
  "replay": false,
  "requirements": [
    {
      "requirementId": "req_…",
      "brandId": "brand_…",
      "brandName": "Acme",
      "status": "DRAFT",
      "deepLinkPath": "/staff/requirements/req_…"
    }
  ],
  "lines": {
    "accepted": [{ "lineKey": "SKU1", "sku": "SKU1", "productId": "prod_…", "quantityPlanned": 20, "mapping": "MATCHED_SKU" }],
    "review": [{ "lineKey": "SKU2", "sku": "SKU2", "reason": "UNKNOWN_SKU", "quantityProposed": 5 }],
    "rejected": [{ "lineKey": "SKU3", "sku": "SKU3", "reason": "INVALID_QUANTITY", "detail": "…" }]
  },
  "deepLinkPath": "/staff/requirements/req_…"
}
```

**`202 Accepted`** — only if processing is async (not required for v1; prefer sync create).

**Errors**

| HTTP | Code | When |
|------|------|------|
| 401 | `UNAUTHORIZED` | Missing/invalid integration credential |
| 403 | `FORBIDDEN` | Credential valid but company binding / scope fails |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key, different payload hash |
| 409 | `COMPANY_MISMATCH` | Body `cosmoCompanyId` ≠ credential binding |
| 422 | `VALIDATION` | Schema/contract version/empty items |
| 422 | `NO_ACCEPTABLE_LINES` | All lines rejected; **no** draft created |
| 503 | `TEMPORARY_UNAVAILABLE` | Safe to retry |

---

## 2. Example request / responses

### Request

```http
POST /api/integrations/cosmo/v1/requirement-imports
Authorization: Bearer <portal_integration_token>
Idempotency-Key: cosmo:send:clx…:2026-11-12:a1b2c3
X-Contract-Version: cosmo-osf-push.v1
```

```json
{
  "contractVersion": "cosmo-osf-push.v1",
  "idempotencyKey": "cosmo:send:clx…:2026-11-12:a1b2c3",
  "source": {
    "system": "cosmo-os",
    "cosmoCompanyId": "clx_cosmo_company",
    "sentAt": "2026-11-12T10:40:00.000Z",
    "asOfDate": "2026-11-12",
    "osfVariant": "main",
    "actorEmail": "buyer@example.com"
  },
  "selection": {
    "mode": "SUPPLIER_ORDERS_SELECTION",
    "brandFilter": { "cosmoVendorId": "vnd_1", "name": "Buddy Brand" },
    "priorityFilter": "Top Priority"
  },
  "items": [
    {
      "lineKey": "ABC_1",
      "sku": "ABC_1",
      "description": "Serum 30ml",
      "brand": { "cosmoVendorId": "vnd_1", "name": "Buddy Brand" },
      "priorities": { "erp1": "Top Priority", "erp2": null },
      "quantity": { "totalOrderQty": 20 }
    }
  ]
}
```

### Success (matched)

`201` with `status: "PROCESSED"`, one DRAFT requirement, `lines.accepted` for `ABC_1`, `deepLinkPath` to that draft.

### Partial (unknown SKU kept for review)

`201` with accepted lines on draft; unknown SKUs in `lines.review` **and** persisted on `OsfImport.payload` for staff resolution UI (not silent product create).  
*(Open decision: whether `review` lines block `PROCESSED` vs allow draft of matched-only — see §8.)*

### Idempotent retry

Same key + same payload hash → `200`, `replay: true`, same `importId` / requirement ids / deep link. No second draft.

### Conflict

Same key + different body → `409 IDEMPOTENCY_CONFLICT`.

---

## 3. Authentication and company mapping

**Recommended v1:** Portal-issued **integration credential** (secret) bound to exactly one Portal `Company.id` and one allowed Cosmo `cosmoCompanyId`.

```
Cosmo env: SUPPLIER_PORTAL_BASE_URL, SUPPLIER_PORTAL_TOKEN
Portal: IntegrationCredential { tokenHash, companyId, cosmoCompanyId, isActive }
```

**Validation order (deny by default):**

1. Authenticate token → resolve binding `{ portalCompanyId, cosmoCompanyId }`.
2. Reject if body `source.cosmoCompanyId` ≠ binding `cosmoCompanyId`.
3. All writes use **`portalCompanyId` from binding**, never from the client body.
4. Optional: IP allowlist / separate tokens per env (dev/prod).

Pattern reference only: Cosmo merchant `X-API-Key` + SHA-256 compare (`lib/merchant-orders/auth.ts`). Prefer `Authorization: Bearer` for Portal so Cosmo can rotate without inventing a second header family. OAuth client-credentials is a later upgrade; not required to start.

**Do not** reuse Cosmo Auth0 session cookies across apps.

---

## 4. Product / brand mapping rules

Prefer staff review over auto-creating wrong masters.

| Case | Behavior |
|------|----------|
| **Existing SKU** | Within Portal `companyId`, find active `Product` where `sku` exact-match (case policy: exact as sent). If **exactly one** and `brandId` matches resolved brand → accept; set `cosmoItemId` only when unambiguously known (optional later). |
| **Ambiguous SKU** | Multiple products same SKU → `review` / reject line; **no** auto-pick. |
| **Unknown SKU** | Do **not** auto-create `Product`. Line → `review` with proposed description/qty/brand; staff maps or creates provisional product, then adds to draft. |
| **Existing brand** | Match Portal `Brand` by `@@unique([companyId, name])` using Cosmo `brand.name` (trim; exact case-sensitive first; optional case-insensitive if unique). Store Cosmo `cosmoVendorId` only in import payload / future external-id table — **not invented schema in this contract**. |
| **Unknown brand** | Do **not** auto-create brand. Entire brand group → fail import **or** `review` with no draft until staff creates brand (open decision). Default proposal: **reject import for that brand group** with clear error; staff create brand once, Cosmo resend. |
| **Duplicate SKU in one import** | Reject payload `422` **or** merge quantities only if identical brand+sku (open decision). Default: **reject duplicates** so Cosmo UI must send unique SKUs. |
| **Zero quantity** | Default: **exclude** from draft (`rejected` reason `ZERO_QUANTITY`). Do not create requirement lines with qty 0 (Portal draft schema requires qty > 0). |
| **Invalid quantity** | Non-finite, negative, non-integer (if we require integers), or > max → `rejected` `INVALID_QUANTITY`. |
| **Changed OSF snapshot** | New quantities / selection → **new** `idempotencyKey` → new import + new draft(s). Never overwrite a confirmed requirement. |
| **Same import retried** | Same key + same hash → replay. Same key + different hash → `409`. |
| **Multi-brand selection** | Portal requirement is single-brand. Default proposal: **one draft per brand** in one import transaction; response `requirements[]`. Mixed brands without split → `422` if we choose single-draft-only (open decision). |

Supplier hints (`latestSupplierName`) are informational only; Portal routing stays post-confirm distribute.

---

## 5. Idempotency and retry

| Topic | Design |
|-------|--------|
| Key owner | Cosmo generates before POST; persists with send attempt |
| Suggested format | `cosmo:osf-push:{cosmoCompanyId}:{yyyy-mm-dd}:{ulid}` (opaque to Portal) |
| Portal storage | Existing `OsfImport.idempotencyKey` unique per `companyId`; store payload + **payloadHash** |
| Lifecycle | RECEIVED → PROCESSED \| FAILED; replay returns stored success body |
| Cosmo retries | Idempotent retries on `408/429/5xx/network`; max 3–5 with backoff; timeout ~30–60s |
| Timeout after unknown | Retry **same** key (safe); never mint a new key for the same user click |
| User “Send again” after success | New key → new draft (unless explicit “replace draft” — out of v1) |
| Duplicate delivery | Same key = one logical import; no double draft |

---

## 6. UX flow (simplest)

```
Cosmo OS → OSF Hub → Supplier Orders panel
  → Filter brand/priority (existing)
  → Select rows with TOTAL ORDER QTY > 0 (existing selection)
  → [Send to Supplier Portal]
  → Cosmo server: computeTotalOrderQtyForSkus for selected SKUs
       + build snapshot + Idempotency-Key
  → POST Portal ingest
  → UI: Success → “Open draft” (Portal deep link)
       Failure → show HTTP/error + rejected SKUs
  → Portal: /staff/requirements/[id] DRAFT
  → Staff resolve review lines / edit qty → Confirm
  → Existing distribute → supplier requests
```

No retyping of SKU/qty for matched lines. No auto-send to suppliers.

---

## 7. Required changes per repository

### Cosmo OS
- Server-only portal client (URL + token)
- `POST /api/admin/osf/supplier-portal/send` (session + OSF RBAC) building snapshot from selection
- Reuse `computeTotalOrderQtyForSkus` + catalog fields from items path
- UI on **Supplier Orders** panel: Send + success/failure + open link
- Optional send-audit table (key, hash, portal import id, status)
- Env secrets only; never send ERP credentials

### Supplier Portal
- Ingest route + Zod for `cosmo-osf-push.v1`
- Integration credential → company binding (may need **approved** schema for credentials if none exists)
- Map → `OsfImport` + `createDraftRequirementForCompany` (extend adapter; stop inventing fields outside this contract)
- Staff UI: import review for unknown SKUs; deep link target
- Authz: integration actor or system user for audit (`REQUIREMENT_DRAFT_CREATED` source `OSF_IMPORT` already prepared)

---

## 8. Open decisions (need approval)

1. **Partial accept:** matched-only draft + `review` lines vs all-or-nothing if any unknown SKU.
2. **Unknown brand:** reject brand group vs staff-create-then-retry vs controlled brand create on import (not recommended).
3. **Multi-brand send:** auto-split to N drafts vs require single-brand selection in Cosmo.
4. **Duplicate SKU in payload:** reject vs merge qty.
5. **Zero qty lines:** drop silently vs list in `rejected`.
6. **Stock/ROP in v1:** omit vs optional `snapshot` (must reuse Cosmo workbook column math, not Portal formulas).
7. **SKU match:** exact only vs also `cosmoItemId` / barcode fallback (Portal has no barcode field today).
8. **Ambiguous Portal SKU:** hard fail line vs staff picker (recommended).
9. **Integration auth storage:** new `IntegrationCredential` model (needs schema approval) vs env single-tenant key for first company only.
10. **Replace draft:** out of scope vs later “replace open DRAFT for same brand”.
11. **Vault OSF:** excluded unless separately approved.
12. **System actor for audit:** dedicated integration user vs attribute-only on `OsfImport`.

---

## 9. Safe implementation sequence

1. **Approve this contract** (resolve §8 defaults).
2. Portal: auth binding + ingest validate + `OsfImport` persist + idempotency (**no** auto product create).
3. Portal: map matched SKUs → draft via existing draft service; deep link.
4. Cosmo: snapshot send from Supplier Orders + UI feedback.
5. Portal: staff review UI for unknown SKUs; confirm → existing distribute.
6. Harden: retries, metrics, key rotation; optional stock/ROP enrichment.
7. Only then consider Portal→Cosmo pull.

---

## Stop for contract approval

Please confirm or adjust §8 (especially **1 partial accept**, **3 multi-brand**, **9 credential storage**). After approval, implementation can start at sequence step 2 — still Neon development only, schema changes only with explicit approval.