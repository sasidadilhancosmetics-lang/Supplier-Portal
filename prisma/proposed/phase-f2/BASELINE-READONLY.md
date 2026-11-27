# Phase F2 — Read-only database safety report

**Captured:** 2026-11-13T07:22:15.830Z  
**Branch:** `br-morning-glade-b3odmb6e` (Neon development)  
**Production refused:** `br-fancy-voice-b33wenqw`  
**Mode:** SELECT only — no mutations

## Branch identity

| Field | Value |
| --- | --- |
| `NEON_BRANCH_ID` | `br-morning-glade-b3odmb6e` |
| Is production | **No** |

## Supplier.externalId

| Check | Result |
| --- | --- |
| Supplier rows | 2 |
| Non-null `externalId` | **0** |
| Duplicate `(companyId, externalId)` | **none** |
| Existing writers / integrations | **none** (Auth0 uses `ExternalIdentity`) |
| New unique feasible | **Yes** (NULLs remain allowed) |

## OsfImportLine

| Check | Result |
| --- | --- |
| Row count | 12 |
| Distinct imports | 3 |
| Null companyId / osfImportId | 0 |
| companyId mismatch vs parent import | **0** |
| Approved uniques already present | **No** |

## F2 objects already present?

| Object | Exists |
| --- | --- |
| `OsfRequestSuggestion` table | No |
| `OsfRequestSuggestionMappingStatus` enum | No |
| `OsfImportLine_id_companyId_key` | No |
| `OsfImportLine_id_osfImportId_companyId_key` | No |
| `Supplier_companyId_externalId_key` | No |

## Migration history (`_prisma_migrations`)

1. `20261111140000_init`
2. `20261111153000_external_identity`
3. `20261111183000_supplier_invitation`
4. `20261112040000_supplier_self_registration`
5. `20261112060000_stage5b_requests_availability`
6. `20261112120000_phase_b_osf_import_review`

No F2 migration recorded (expected).

## Purchase orders

| Check | Result |
| --- | --- |
| Protected `PO-20261112-E5D42983` | **CONFIRMED** |
| Total PO rows | 1 |

## OsfImport status mix

| Status | Count |
| --- | --- |
| NEEDS_REVIEW | 3 |
| READY_TO_CONFIRM | 2 |

## Conclusion

Development data is compatible with the proposed additive migration. Preflight checks in `migration.sql` should pass on this baseline.
