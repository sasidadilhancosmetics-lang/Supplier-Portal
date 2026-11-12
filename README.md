# Supplier Portal

Supplier procurement portal for one purchasing company and many suppliers. Stage 3A adds the Auth0 authentication foundation on top of the Neon/Prisma schema.

## Requirements and design

- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Decisions](docs/decisions.md)
- [Database design](docs/database-design.md)
- [Implementation plan](docs/implementation-plan.md)
- [Database setup](docs/database-setup.md)
- [Auth0 setup](docs/auth0-setup.md)
- [Authorization (Stage 3B)](docs/authorization.md)
- [Admin suppliers (Stage 4A)](docs/suppliers-admin.md)

## Local development

```bash
npm install
cp .env.example .env.local
# Fill Neon + Auth0 values (never commit secrets)
npm run db:generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Auth routes: `/auth/login`, `/auth/logout`, `/auth/callback`. Unknown Auth0 users land on `/access-pending`.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
