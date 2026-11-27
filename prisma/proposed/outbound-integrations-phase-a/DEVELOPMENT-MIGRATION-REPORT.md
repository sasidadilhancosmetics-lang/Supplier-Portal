# Phase A outbound integrations development migration

**20 November 2026 · PASS**

Prisma recorded the single approved Phase A migration on Neon development. Post-migration verification confirmed an empty outbound connection table, the unchanged supplier composite foreign key, and matching business row fingerprints.

## Verified target and input

| Item | Evidence |
| --- | --- |
| Neon project | `holy-art-38015209` |
| Development branch | `br-morning-glade-b3odmb6e` |
| Direct endpoint | `ep-little-credit-b35km102` · `ep-little-credit-b35km102.c-4.ap-southeast-1.aws.neon.tech` |
| Migration | `20261120120000_phase_a_outbound_integrations` |
| Reviewed SQL | [Phase A proposal](migration.sql) |
| Canonical SQL | [Prisma migration](../../migrations/20261120120000_phase_a_outbound_integrations/migration.sql) |
| SHA-256 | `072c8fd2f3dfe27de82690649a6f0bf049272787606728618b272a8f1df28c1a` |
| Prisma CLI | `7.10.1` |

Neon metadata bound the endpoint to development. The effective URL selected by `prisma.config.ts` and the endpoint reported by Prisma matched this direct host. Both SQL files were byte-identical. The reviewed SQL creates Phase A objects inside its own transaction, without altering existing tables.

## Preflight and execution

- All ten existing migration records were successful, with exact local SQL checksum matches. No failed or unresolved migration record was present.
- The Phase A enum, table, and trigger function were absent. Purchase order, delivery, GRN, and Cosmo credential counts matched the prior development baseline.
- The live supplier-isolation FK was validated and matched the expected composite definition.
- `prisma migrate status` found eleven local migrations and identified only `20261120120000_phase_a_outbound_integrations` as pending. Exit code 1 was the expected pending status.
- The installed Prisma CLI ran `migrate deploy` once. It exited 0 and reported success. No custom history writes or schema synchronization were used.
- Read-only verification found exactly one new successful Phase A record with the reviewed checksum. The ten earlier records matched in full. Final `prisma migrate status` exited 0 and reported the schema up to date.

## Verified PostgreSQL objects

| Object | Verified definition or behavior |
| --- | --- |
| `OutboundIntegrationProvider` | Enum values `ERP_NEXT` and `SHOPIFY` |
| `OutboundIntegrationConnection` | Primary key on `id`. Company FK references `Company(id)` with `ON UPDATE RESTRICT` and `ON DELETE RESTRICT`. |
| Provider and origin uniqueness | Unique index on `(companyId, provider, origin)`. |
| Enabled Shopify uniqueness | Valid partial unique index on `companyId` for rows with provider `SHOPIFY` and `enabled = true`. |
| Credential checks | All five credential fields present or all absent. Nonempty ciphertext, 12-byte nonce, 16-byte tag, and nonblank key ID. Enabled rows require a complete bundle. |
| Label, version, and origin checks | Trimmed label of length 1–100, positive configuration version, and reviewed HTTPS and Shopify hostname shape checks. |
| Identity trigger and function | The enabled before-update trigger calls `rejectOutboundIntegrationIdentityChange()`. It rejects edits to ID, company ID, provider, and origin. |
| Initial rows | 0. No synthetic fixtures were inserted on development. |

The catalog check also verified the table's nine column `NOT NULL` constraints. Origin shape checks are database constraints. Network destination enforcement remains a separate application concern.

## Existing data and constraints

The exact live `PriceAgreement` constraint definition matched before and after. It remained validated.

```sql
FOREIGN KEY ("availabilityOfferId", "supplierId") REFERENCES "AvailabilityOffer"(id, "supplierId") ON UPDATE CASCADE ON DELETE RESTRICT
```

| Record group | Before | After |
| --- | ---: | ---: |
| Purchase orders | 2 | 2 |
| Deliveries | 5 | 5 |
| GRNs | 5 | 5 |
| Cosmo integration credentials | 0 | 0 |
| Prisma migration records | 10 | 11 |

Row fingerprints matched for Company, Supplier, PurchaseOrder, OrderItem, Delivery, DeliveryItem, Grn, GrnItem, IntegrationCredential, PriceAgreement, and AuditLog. All 410 checked pre-existing public constraint definitions and validation flags were identical before and after. The known Prisma relation drift was left outside this migration.

## Outcome and next step

No failure, uncertain outcome, or unexpected difference was observed. No production database access, rehearsal branch change, real ERPNext or Shopify connection, credential provisioning, or application deployment occurred.

Next, obtain separate approval for authenticated Admin Integration Settings UAT. Use the local application with an authorized test admin and synthetic settings. Begin by verifying the Admin route, access denial, the empty outbound list, and read-only Cosmo status. Any synthetic writes to development require explicit authorization for the fixtures and cleanup. Keep provider testing in mock mode.
