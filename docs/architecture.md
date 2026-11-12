# Architecture

This document describes what exists today and the boundaries for later phases.

## What exists now

A Next.js App Router application with TypeScript, Tailwind CSS, ESLint, and shadcn/ui. The `src` directory and the `@/*` import alias are in use.

Routes:

| Route | Status |
| --- | --- |
| `/` | Welcome page. Explains the foundation. No data. |
| `/admin` | Non-functional placeholder |
| `/staff` | Non-functional placeholder |
| `/supplier` | Non-functional placeholder |

### Stage 2B (database setup)

- Design: [docs/database-design.md](database-design.md)
- Setup: [docs/database-setup.md](database-setup.md)
- Schema: `prisma/schema.prisma`
- CLI: `prisma.config.ts` (migrate uses unpooled URL)
- Runtime: `src/lib/db.ts` with `@prisma/adapter-neon` (pooled `DATABASE_URL`)
- Health: `GET /api/health/db` (ok/down only; no secrets)

Migrations apply only after approval on an empty **development** database. Authentication and business APIs are not implemented. Placeholder pages still do not load procurement data.

Server and client boundary: pages are Server Components. The site navigation is a Client Component because it reads the current path for `aria-current`. No secrets are passed into client components.

## Intended shape (not built)

Keep modules small and put authorization on the server. Separate:

- Identity and permissions (admin, staff, supplier users scoped to a supplier company)
- Supplier profile and brands
- Requirements, requests, and supplier responses (supplier-owned availability)
- Allocation, orders, deliveries, and GRN
- Product offers
- Notifications and audit events
- Read models for dashboards and the later performance score

Critical state changes (response submit, reserve, allocate, confirm, cancel, deliver, issue GRN) should run in Prisma transactions and be idempotent. Staff availability must not be writable as if it were supplier availability.

External systems get adapters with explicit interfaces. Until Cosmo OS / OSF publishes a contract, the adapter stays a documented interface plus a development-only mock. The mock must not be wired up as if it were production, and it must not be presented as real supplier or stock data.

ERP stock posting is Phase 2. Phase 1 stops at an immutable GRN that a person can post manually in the ERP.

## Tenancy and access (Phase 1)

- One purchasing `Company`.
- Many `Supplier` companies.
- `User.role` is `ADMIN`, `STAFF`, or `SUPPLIER`.
- Supplier users must have `supplierId` set; queries for supplier data filter on that id.

## Security boundaries

- Browser code never receives `DATABASE_URL`, auth secrets, or integration credentials.
- `NEXT_PUBLIC_` is reserved for values that are safe to expose. None are required yet.
- Authorization is server-side. A role in the client is not proof of permission.
- Input from users and from Cosmo OS is untrusted and will be validated with Zod at the boundary.
- Audit records should store actor, time, and the change. Tables are proposed; writers are not implemented yet.

## Environments

`.env.example` lists placeholder names only. Local secrets belong in `.env.local`, which is gitignored. Development and production databases must be separate once a database exists. Stage 2A does not connect to Neon.
