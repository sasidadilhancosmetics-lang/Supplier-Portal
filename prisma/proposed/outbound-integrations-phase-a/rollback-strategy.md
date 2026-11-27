# Phase A rollback strategy

Keep application rollback available by using an additive migration. The preceding application can run with the outbound table and enum in place.

## If application verification fails

1. Stop Phase A rollout and return to the previous application build. Keep live provider transport disabled.
2. Leave the table, trigger, audit history, and migration record in place. Review sanitized diagnostics and preserve evidence.
3. If the schema itself needs correction, prepare a reviewed forward migration. Keep any database or branch cleanup under separate approval.

## If the migration fails

The DDL is transactional. Inspect the branch catalog and Prisma migration history read-only to confirm what committed. Prisma may record an unsuccessful attempt even when PostgreSQL rolls back the DDL. Resolve migration history only after reviewing the actual state and receiving separate authorization.

A destructive rollback is outside this proposal. Retain the rehearsal branch until the reviewer has accepted the results. Branch removal, data deletion, and restoring or resolving migration state require separate permission.
