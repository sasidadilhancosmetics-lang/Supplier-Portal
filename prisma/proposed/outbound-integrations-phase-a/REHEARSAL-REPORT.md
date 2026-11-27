# Phase A outbound integrations rehearsal report

**20 November 2026 · PASS · 31 synthetic constraint tests passed, 0 failed.**

The reviewed SQL committed once on the authorized Neon rehearsal child. The Phase A table is empty after fixture rollback. The validated supplier composite foreign key, existing migration history, and checked business data match the expected baseline.

## Target and execution

| Item | Verified value |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Rehearsal branch | `rehearsal-phase-a-outbound-integrations` |
| Rehearsal branch ID | `br-royal-dawn-b3xv19i3` |
| Development parent | `br-morning-glade-b3odmb6e` |
| Direct endpoint ID | `ep-frosty-bread-b3iomb1w`, verified as belonging to the rehearsal child |
| Approved input | [Phase A migration SQL](migration.sql) |
| SHA-256 | `072c8fd2f3dfe27de82690649a6f0bf049272787606728618b272a8f1df28c1a` |
| Execution | Exact file submitted directly with its own `BEGIN` and `COMMIT`. PostgreSQL confirmed the commit. |

Preflight matched the child, parent, and direct endpoint metadata. All ten existing Prisma migration directories matched recorded checksums. The Phase A enum, table, and trigger function were absent. The SQL contained only transactional additions for Phase A and no provider calls, destructive statements, changes to existing tables, or existing-data mutations.

The Phase A SQL was applied **outside Prisma migration history**. All ten existing records are complete and checksum-matched. There is no recorded Phase A Prisma migration, and there was no manual write to `_prisma_migrations`.

## Created schema and catalog verification

- Enum `OutboundIntegrationProvider` contains `ERP_NEXT` and `SHOPIFY`.
- Table `OutboundIntegrationConnection` has the following validated constraints. Names in the table use the `OutboundIntegrationConnection_` prefix.

| Constraint suffix | Verified definition | Status |
| --- | --- | --- |
| `bundle_chk` | All five credential fields present or all absent | Validated |
| `companyId_fkey` | Company FK with `ON UPDATE RESTRICT` and `ON DELETE RESTRICT` | Validated |
| `credential_shape_chk` | Nonempty ciphertext, 12-byte nonce, 16-byte tag, and nonblank key ID | Validated |
| `enabled_credential_chk` | Enabled rows require a credential bundle | Validated |
| `label_chk` | Trimmed label with length 1–100 | Validated |
| `origin_chk` | Canonical HTTPS origin shape and Shopify hostname shape | Validated |
| `pkey` | Primary key on `id` | Validated |
| `version_chk` | Positive `configVersion` | Validated |

The catalog confirmed all three indexes are valid and unique. They cover the primary key, `(companyId, provider, origin)`, and one enabled Shopify connection per company through the predicate `provider = 'SHOPIFY' AND enabled`. PostgreSQL also reported nine column `NOT NULL` constraints.

The enabled `OutboundIntegrationConnection_identity_immutable` trigger runs before each update. Its function rejects changing the ID, company, provider, or origin. Catalog inspection verified the trigger and function definitions.

## Synthetic test results

Two synthetic companies and disposable test rows were used in one transaction. Expected failures were isolated with savepoints. The outer transaction was rolled back, leaving zero Phase A rows and no persisted fixtures or audit entries. Constraint names below omit the `OutboundIntegrationConnection_` prefix.

| # | Test | Result | Observed evidence |
| --- | --- | --- | --- |
| 1 | Valid company and disabled/no credentials defaults | PASS | Accepted or matched the expected result |
| 2 | Invalid company fails | PASS | `23503` · `companyId_fkey` |
| 3 | Distinct ERPNext origins in same company | PASS | Accepted or matched the expected result |
| 4 | Duplicate origin in same company rejected | PASS | `23505` · `companyId_provider_origin_key` |
| 5 | Same origin allowed in second company | PASS | Accepted or matched the expected result |
| 6 | First enabled Shopify in company | PASS | Accepted or matched the expected result |
| 7 | Second enabled Shopify in same company rejected | PASS | `23505` · `one_enabled_shopify_key` |
| 8 | Disabled additional Shopify in same company | PASS | Accepted or matched the expected result |
| 9 | Enabled Shopify in second company | PASS | Accepted or matched the expected result |
| 10 | Switch enabled Shopify store in one transaction | PASS | Accepted or matched the expected result |
| 11 | Enabled without credential bundle rejected | PASS | `23514` · `enabled_credential_chk` |
| 12 | Partial credential bundle missing credentialCiphertext | PASS | `23514` · `bundle_chk` |
| 13 | Partial credential bundle missing credentialNonce | PASS | `23514` · `bundle_chk` |
| 14 | Partial credential bundle missing credentialTag | PASS | `23514` · `bundle_chk` |
| 15 | Partial credential bundle missing credentialKeyId | PASS | `23514` · `bundle_chk` |
| 16 | Partial credential bundle missing credentialRotatedAt | PASS | `23514` · `bundle_chk` |
| 17 | Invalid nonce length rejected | PASS | `23514` · `credential_shape_chk` |
| 18 | Invalid tag length rejected | PASS | `23514` · `credential_shape_chk` |
| 19 | Empty synthetic ciphertext rejected | PASS | `23514` · `credential_shape_chk` |
| 20 | Blank key ID rejected | PASS | `23514` · `credential_shape_chk` |
| 21 | Nonpositive configuration version rejected | PASS | `23514` · `version_chk` |
| 22 | Blank or untrimmed label rejected | PASS | `23514` · `label_chk` |
| 23 | Immutable id | PASS | `23514` · `identity_immutable` |
| 24 | Immutable companyId | PASS | `23514` · `identity_immutable` |
| 25 | Immutable provider | PASS | `23514` · `identity_immutable` |
| 26 | Immutable origin | PASS | `23514` · `identity_immutable` |
| 27 | Allowed label and configuration version changes | PASS | Accepted or matched the expected result |
| 28 | HTTPS origin shape rejects HTTP | PASS | `23514` · `origin_chk` |
| 29 | HTTPS origin shape rejects a non-root path | PASS | `23514` · `origin_chk` |
| 30 | Shopify host shape rejects external domain | PASS | `23514` · `origin_chk` |
| 31 | No rejected fixture rows or partial fixture updates remain | PASS | Accepted or matched the expected result |

The second enabled Shopify connection was rejected in the same company and accepted in a different company. The rehearsal verified the database constraint in a single session. It did not run a separate two-session race.

## Supplier foreign key and existing data

The following exact definition was captured before the migration and after the fixture rollback. It matched in full and remained validated.

```sql
FOREIGN KEY ("availabilityOfferId", "supplierId") REFERENCES "AvailabilityOffer"(id, "supplierId") ON UPDATE CASCADE ON DELETE RESTRICT
```

| Baseline | Before migration | After rehearsal |
| --- | --- | --- |
| Purchase orders | 2 | 2 |
| Deliveries | 5 | 5 |
| GRNs | 5 | 5 |
| Cosmo credential rows | 0 | 0 |
| Prisma migration records | 10 | 10 |

Before the synthetic tests, the post-migration child matched a read-only development snapshot for row fingerprints across Company, Supplier, PurchaseOrder, OrderItem, Delivery, DeliveryItem, Grn, GrnItem, IntegrationCredential, PriceAgreement, AuditLog, and the Prisma migration table. All 410 pre-existing constraint definitions and validation flags also matched. The same child fingerprints, migration rows, and constraint catalog matched again after fixture rollback. The initial migration run recorded aggregate counts and the exact supplier FK before applying SQL. Its in-memory row fingerprints were not retained after the first verification process exited, so the read-only parent comparison was used as an independent check of the inherited rows.

## Unexpected findings and next step

The first catalog verifier counted the nine implicit PostgreSQL 18 `NOT NULL` constraints as part of the expected explicit-constraint total and stopped after the migration had already committed. The corrected verifier checked the explicit constraints and column requirements separately. The migration SQL was not edited or reapplied.

Database origin checks enforce syntax. Admin authorization, server-side SSRF controls, credential encryption and rotation, and mocked connection behavior require separate implementation and tests. The existing PriceAgreement Prisma drift remains outside Phase A.

Keep the rehearsal child for review. Seek separate explicit approval for application implementation or applying Phase A to development. No application code was deployed, no existing branch was reset or deleted, and no production database or external provider was contacted.
