---
name: feature-dev-qa
description: >-
  Feature development, testing, and QA for Supplier Portal. Use when implementing
  features, writing unit/integration tests, verifying stages, fixing regressions,
  or running lint/typecheck/build. Covers idempotency, authz tests, concurrency,
  audit/notification consistency, and gated Neon integration tests.
---

# Feature development and QA

## Canonical docs

- [docs/implementation-plan.md](../../../docs/implementation-plan.md)
- [docs/orders-allocation.md](../../../docs/orders-allocation.md)
- [docs/decisions.md](../../../docs/decisions.md)
- [docs/supplier-requests-availability.md](../../../docs/supplier-requests-availability.md)
- Root [AGENTS.md](../../../AGENTS.md) for Next.js version guidance (do not edit it)

## Implementation loop

1. Load matching domain skills (`supplier-portal-architecture`, auth, prisma, UI as needed).
2. Inspect existing models/services before writing code.
3. Prefer smallest safe change; no speculative refactors.
4. Prefer **existing server actions and domain queries** — do not reimplement business rules in UI.
5. Never silently change business behavior during UI-only work.
6. Preserve authorization and tenant isolation (`auth-supplier-isolation`).
7. Before handoff, run relevant regression tests plus: `npm run typecheck` (and `npm test` / lint / build when feasible).

## Required checks for relevant mutations

For allocate, confirm, cancel, availability submit, distribute, schedule/reschedule, verify/receipt (as applicable):

| Concern | Expectation |
|--------|-------------|
| Authz / isolation | Unit tests for allow, deny, cross-supplier `NOT_FOUND`, inactive supplier |
| Idempotency | Same key+payload replay; same key different payload rejected; no duplicate side effects |
| Concurrency | Conditional updates / locks; Neon integration tests when races matter (`RUN_DB_INTEGRATION=1`) |
| Audit | Single event on success; none on rolled-back failure |
| Notifications | Deduped recipients; none on failure / idempotent replay |
| Quantities / reserves / holds | Allocations unchanged on confirm; release math on cancel; no accidental reserve extension; schedule capacity uses active holds only |

## Test placement

- Authz/domain: `*.authz.test.ts`, math helpers beside implementation
- Neon concurrency: `*.concurrency.integration.test.ts` gated by env
- Prefer mocking `server-only` / guards / prisma in unit tests

## Do not

- Skip failing tests to “green” the build
- Apply migrations or touch production from QA scripts — migrations need **explicit approval**; never write production without authorization
- Invent unresolved Stage behavior without architecture approval
- “Fix” unrelated build config during UX sprints

## Cache Components / route `runtime`

With `nextConfig.cacheComponents`, do **not** export `runtime` on route segments
(including `runtime = "nodejs"`). Node.js is already the default. Prefer removing
a redundant `runtime` export over disabling `cacheComponents`.

## Related skills

- Architecture → `supplier-portal-architecture`
- DB → `prisma-neon-safety`
- Auth → `auth-supplier-isolation`
- UI → `ui-ux-performance`
