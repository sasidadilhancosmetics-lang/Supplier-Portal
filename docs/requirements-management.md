# Product master & requirement management (Stage 5A)

## Scope

- Product master (provisional development products)
- Manual draft requirements, item editing, confirmation
- Service boundary for future Cosmo OS OSF → draft requirement flow

**Not in 5A:** supplier request distribution, availability, POs, deliveries, real Cosmo/ERP APIs, inventing ERP-linked products.

## Permissions (provisional catalog)

| Action | Permission | Notes |
| --- | --- | --- |
| Product list/create/edit | `MANAGE_PRODUCTS` | ADMIN bypasses |
| Brand create (dev helper) | `MANAGE_BRANDS` | ADMIN bypasses |
| Requirement list/view | `MANAGE_REQUIREMENTS` or `CONFIRM_REQUIREMENT` or `SEND_SUPPLIER_REQUEST` | ADMIN bypasses |
| Requirement draft/edit | `MANAGE_REQUIREMENTS` | Split in Stage 5B |
| Requirement confirm | `CONFIRM_REQUIREMENT` | ADMIN bypasses |

SUPPLIER users cannot access `/staff/*` (layout + action guards).

## Routes

| Path | Purpose |
| --- | --- |
| `/staff/products` | List/search products |
| `/staff/products/new` | Create **PROVISIONAL** product |
| `/staff/products/[id]` | View/edit permitted fields |
| `/staff/requirements` | List/filter requirements |
| `/staff/requirements/new` | Create empty draft |
| `/staff/requirements/[id]` | Edit draft items / confirm / read-only confirmed |

Admin hub links into the staff routes (ADMIN bypasses staff permissions).

## Product rules

- Manual create always sets `masterStatus = PROVISIONAL`, `erpItemId = null`, `cosmoItemId = null`.
- Edits never promote to `ERP_LINKED` or invent ERP identifiers.
- Display distinguishes Provisional vs ERP linked.
- `companyId` from authenticated user only.

## Requirement rules

- Quantities must be `> 0`.
- Products on a requirement must belong to the requirement’s brand and company.
- Duplicate products on one requirement are rejected.
- Only `DRAFT` can be edited; confirmed is read-only in 5A.
- Confirm requires ≥1 item; concurrent confirms use `updateMany` status claim (`ALREADY_CONFIRMED` on race).
- Confirmation is audited (`REQUIREMENT_CONFIRMED`).

## Cosmo OS integration contract (future)

Planned flow:

`Cosmo OS → Send to Supplier Portal → Draft Requirement → Staff Review → Confirm`

Stage 5A prepares:

1. **`createDraftRequirementForCompany` / `createDraftRequirementFromUnknown`**  
   (`src/lib/requirements/draft-service.ts`) — shared draft creator. Accepts optional `osfImportId`.

2. **`OsfImport`** model — store opaque `payload` + company-scoped `idempotencyKey`. Do not invent payload shape.

3. **`mapCosmoOsfPayloadToDraft`** (`src/lib/requirements/cosmo-adapter.ts`) — placeholder that throws until the real OSF contract is documented.

Adapter responsibilities (later stage):

- Authenticate Cosmo OS caller
- Upsert `OsfImport` with idempotency
- Map validated payload → `CreateDraftRequirementInput` (no invented fields)
- Call `createDraftRequirementForCompany`
- Mark import `PROCESSED` / `FAILED`

Unresolved until Cosmo documents: payload schema, auth, push vs pull, idempotency key format.

## Schema

No migration for Stage 5A. Uses existing `Product`, `Brand`, `Requirement`, `RequirementItem`, `OsfImport`, `AuditLog`.

## Manual E2E (development)

1. As ADMIN, open `/staff/products` → create a brand if needed → create provisional products
2. Open `/staff/requirements/new` → create draft → add products/quantities → confirm
3. Confirm again → already confirmed (idempotent UI/server)
4. As SUPPLIER, confirm `/staff/products` is blocked
5. As STAFF without `CONFIRM_REQUIREMENT` / `MANAGE_PRODUCTS` grants, actions fail closed

## Unresolved decisions

- Final StaffPermission catalog (whether draft prep should be a separate code)
- Cosmo OS / OSF payload and transport
- When/how `PROVISIONAL` → `ERP_LINKED` promotion happens
- Phase 1 source of ERP-linked “existing products” beyond manual provisional masters
