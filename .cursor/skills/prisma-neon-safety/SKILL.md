---
name: prisma-neon-safety
description: >-
  Prisma and Neon database safety for Supplier Portal. Use for schema review,
  Prisma queries, transactions, migrations, Neon connectivity, allocation/cancel
  quantity math, or any database write. Prefer Neon development; never production
  or destructive resets without explicit user approval.
---

# Prisma and Neon safety

## Canonical docs

- [docs/database-design.md](../../../docs/database-design.md)
- [docs/database-setup.md](../../../docs/database-setup.md)
- [docs/decisions.md](../../../docs/decisions.md)
- [docs/orders-allocation.md](../../../docs/orders-allocation.md)

## Hard safety rules

1. **Neon development only** unless the user explicitly names another target.
2. **Never modify production.**
3. **Never** run destructive resets (`migrate reset`, drop DB, truncate business tables) unless the user explicitly orders it.
4. **Migrations:** if a schema change is needed, prepare the plan/diff and **stop for explicit approval** before applying.
5. Prefer existing schema fields; Stage 5B/6A expected **no migration** unless newly approved.

## Transaction and invariant checklist

For allocate / confirm / cancel (and similar mutations):

- Use Prisma transactions; keep audit + notifications in the **same** transaction as the business write.
- Lock order compatible with allocate: **requirement items → offers → purchase order** (sorted ids).
- Idempotency: client UUID; scope by actor + operation; bind canonical payload hash; replay safely; reject payload mismatch.
- `quantityOrderedActive` release: require `quantityOrderedActive >= quantityToRelease`; atomic conditional update; **never** silently clamp negatives to zero — fail and roll back.
- Preserve `reservedAt` / `reserveExpiresAt` on cancel and on live SUBMITTED quantity edits.
- Do not reactivate `EXPIRED` / `CANCELLED` offers.

## Before finishing DB work

- Confirm no unintended schema drift.
- Prefer read-only verification scripts for production-like checks on development data.
- Hand off migration SQL only after user approval to apply.

## Related skills

- Domain rules → `supplier-portal-architecture`
- Authz on queries → `auth-supplier-isolation`
- Concurrency tests → `feature-dev-qa`
