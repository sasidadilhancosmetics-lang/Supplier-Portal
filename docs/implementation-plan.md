# Implementation plan

Work in small reviewable steps. Do not start a step until the previous one has been reviewed. Do not treat a placeholder page as a finished module.

## 1. Foundation — this change

- Next.js App Router, TypeScript, Tailwind CSS, ESLint, `src/`, `@/*`
- shadcn/ui shell
- Welcome page and non-functional Admin, Staff, and Supplier routes
- Architecture, requirements, decisions, and this plan
- `.env.example` with placeholder names and a gitignore that excludes secrets
- Lint, typecheck, and production build

Explicitly not in this step: Neon, Prisma schema, migrations, authentication, seed data, Cosmo OS adapter.

## 2A. Database schema proposal — done

- [docs/database-design.md](database-design.md)
- Approved `prisma/schema.prisma` and `prisma.config.ts`
- Locked: single purchasing company; multi-user suppliers scoped by `supplierId`

## 2B. Database setup — in progress

- Neon project linked; env in `.env.local` (gitignored)
- Prisma Client + Neon adapter; health check route
- Initial migration prepared; apply only after approval on empty **development** DB
- Explicitly not done: auth, business seed, feature APIs

## 2C. Identity — after DB verified

- Authentication approach
- Server-side sessions and role checks for Admin, Staff, and Supplier
- Permission checks for staff actions, once the permission list is confirmed (Stage 3B foundation: `requireStaffPermission` + unit tests; catalog still provisional)
- Tests for authorization boundaries (Stage 3B: `npm test` / `authorize.test.ts`)

Still no procurement workflow in this step.

## 3. Core transactions

Build only after identity is real, and only with confirmed business rules.

Suggested order, each with tests before the module is called complete:

1. Supplier profile and brands, including the rule that a brand on an active request cannot be removed
2. Inbound requirement adapter interface. Mock labeled development-only. No invented Cosmo OS contract
3. Staff review and confirmation of a draft requirement
4. Brand-specific requests to all matching or selected suppliers, once matching is defined
5. Supplier response: multi-item screen, per-item dates, Not Available, bulk actions, autosaved drafts, partial submit, statuses New / Partially Responded / Responded
6. Seven-day reserve, partial order against that reserve, and availability decreases with notification and warning
7. Company allocation and order, including ordering above the original plan once accounting rules exist
8. Whole-order supplier confirmation
9. Partial deliveries, staff verification, immutable GRN
10. Cancellation with required reason, notification, and re-request
11. Audit trail for dates, quantities, changes, and actors
12. Idempotency and transaction guards against duplicate requests, races, and over-allocation

## 4. Offers, dashboards, and performance

- Product offers: existing or new products, staff interest, supplier reconfirmation, offer-to-order, seven-day validity
- Admin, Staff, and Supplier dashboards with alerts, summaries, search, notifications, and date filters
- Supplier performance score after orders and deliveries are stable

## 5. Phase 2 — out of scope

Direct ERP stock posting, complex analytics, advanced follow-ups, custom roles, and catalog management.

## Done means

A module is complete only when its workflow tests pass, authorization is enforced on the server, and the UI is not backed by unlabeled fake data.
