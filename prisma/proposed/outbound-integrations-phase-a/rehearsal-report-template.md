# Phase A migration rehearsal report

Complete after an authorized rehearsal. Record branch IDs and sanitized results. Omit connection strings, keys, credentials, provider payloads, and fixture data.

## Identity and approval

- Approved scope and approval reference:
- Neon project:
- Development parent branch ID:
- Disposable child branch ID and parent verified:
- Direct endpoint identity verified:
- Candidate migration path and SHA-256:
- Rehearsal date and reviewer:

## Preflight

- Applied history and checksums:
- Pending set Prisma would apply:
- Prisma schema diff and disposition:
- SQL-only baseline checks:
- Existing objects or data baselines selected:
- Any baseline or target discrepancy and decision:

Carry forward the live development baseline for existing objects. The working Prisma schema describes the `PriceAgreement` availability-offer relation by offer ID alone. Development has a composite foreign key on offer ID and supplier ID. Preserve the live composite foreign key throughout this rehearsal. Do not use the working-schema drift output as deployment SQL.

## Rehearsal results

| Check | Result | Sanitized evidence |
| --- | --- | --- |
| Exact reviewed migration applied on approved child | | |
| Expected enum, table, indexes, checks, function, and trigger | | |
| Constraints and concurrent Shopify enables | | |
| Secret handling and mock-only behavior | | |
| Existing Cosmo, order, delivery, and GRN baseline | | |
| Prisma schema alignment and SQL-only object preservation | | |
| Application rollback and branch retention review | | |

## Disposition

- Deviations and open issues:
- Reviewer decision:
- Further actions requiring separate approval:

Stop if the pending set includes any migration outside the approval or if the branch does not match the approved rehearsal target.
