# Development migration execution plan

Executed on 25 November 2026 after explicit owner approval. Keep this record for the reviewed procedure and outcome; do not rerun it.

## Target

- Project holy-art-38015209.
- Development branch br-morning-glade-b3odmb6e.
- Direct endpoint ep-little-credit-b35km102.c-4.ap-southeast-1.aws.neon.tech.
- Database neondb.

The owner postponed backup and KeePassXC setup and accepts possible loss or manual repair of development test data. This removes the backup prerequisite for this scope. Production, Odoo, integration credentials and deployments remain outside scope.

## Reviewed files

Apply the checked-in files unchanged, in order:

1. 20261121120000_supplier_catalogue, SHA-256 8a36c08c53af006b54bc0fb4fe6ab2b9a26ebe056e9d863ea364a127c194a778.
2. 20261123143000_split_availability, SHA-256 8010f2de1e278b2120f5fc079b7e47697c20df7f252f9aeb981ede7d385ff3f3.

Catalogue adds tables for SKU exclusions, immutable supplier price revisions and media mappings, plus indexes, enum and immutability function/trigger. Split Availability adds availableSplits, requiresScheduleApproval (default false for existing POs), scheduleApprovedAt and the split-array check.

## Verified preparation baseline

Neon metadata confirms the endpoint belongs to the named development branch in the named project. PostgreSQL identifies neondb, version 18.7. Checks ran with transaction_read_only=on.

There are 11 completed migrations, all matching local checksums, without unfinished ledger entries. Only the two files above are pending. Their target tables and columns are absent.

Business counts are 2 POs, 2 order items, 5 deliveries, 5 delivery items, 5 GRNs, 5 GRN items, 3 price agreements, 5 quotes, 4 offers, 4 requests, 5 OSF imports and 12 OSF lines.

The validated PriceAgreement_availabilityOffer_fkey is:

```sql
FOREIGN KEY ("availabilityOfferId", "supplierId")
REFERENCES "AvailabilityOffer"(id, "supplierId")
ON UPDATE CASCADE ON DELETE RESTRICT
```

The working Prisma relation is weaker. Do not reconcile that drift or regenerate SQL.

## Execution after approval

1. Ensure development application writes are idle during the execution window. Recheck exact metadata, local migration files, checksums, ledger, pending objects and baseline counts. Stop on a mismatch or an additional pending migration.
2. Load the existing development credential into process environment without logging it. Validate its direct host and database. Set DATABASE_URL, DATABASE_URL_UNPOOLED and DIRECT_DATABASE_URL to that same verified development connection so inherited environment values cannot select another target. Do not edit environment files.
3. From C:\dev\Supplier Portal, run the installed Prisma CLI:

```powershell
.\node_modules\.bin\prisma.cmd migrate deploy --config .\prisma.config.ts
```

Prisma deploy applies all pending files. The preceding gate must prove that exactly the two approved files are pending. Use normal Prisma ledger recording. Do not run db push, migrate dev, reset, db pull or resolve.

4. Read back 13 successful migrations with exact checksums and no unfinished entries. Verify new columns/defaults, tenant foreign keys, unique indexes, the validated split check and enabled price-revision immutability trigger.
5. Compare all existing application-table counts against the immediate pre-execution baseline. New catalogue tables must be empty. Existing POs must have requiresScheduleApproval=false, with no existing split or approval values populated. Confirm the PriceAgreement composite FK definition and validation state exactly match the baseline.
6. Report the outcome and stop. Real integration credential configuration and live provider requests require separate approval.

## Failure handling

Do not assume the two files are an atomic batch. These reviewed SQL files do not contain explicit transaction wrappers, and failure may leave a partial application or one completed migration.

On any error, stop writes and automatic retries. Inspect the ledger and affected objects read-only, report what committed, and prepare a specific repair proposal. Any cleanup, rollback, ledger reconciliation or repair needs separate approval. No verified backup exists for this execution.

## Execution result

Neon metadata and the direct database URL matched the named development project, branch, endpoint and database. The immediate preflight found 11 completed checksum-matched migrations and exactly the two approved pending files. SHA-256 values matched those above. `prisma migrate deploy` applied both files once and returned success. Read-only validation found 13 completed checksum-matched ledger entries; unchanged counts and row digests for all preexisting application tables; 2 POs, 5 deliveries, 5 GRNs, 3 price agreements and 5 OSF imports; three empty catalogue tables; all expected new columns; validated tenant composite FKs; an enabled immutable-price trigger; and the unchanged validated PriceAgreement composite FK. No repair, rollback, schema reconciliation or other hosted mutation was performed. Integration configuration remains separately gated.
