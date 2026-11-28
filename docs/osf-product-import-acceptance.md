# Development OSF product import acceptance

The existing authenticated importer provisions OSF-owned brand/product references and creates Draft requirements. Staff reviews and confirms those requirements separately. Manual product creation remains unavailable. An import never creates a PO or sends supplier requests automatically.

## Local verification and bounded fixture

The fixture [osf-product-import.example.json](fixtures/osf-product-import.example.json) contains one synthetic vendor/brand and two synthetic SKUs with quantities 2 and 3. Its source company is deliberately synthetic; it must match a separately approved development test credential binding. It contains no bearer token or production records.

Route tests mock the ingest service. Provisioning, mapping, payload validation, replay and permission tests exercise their respective services with synthetic dependencies. These checks do not establish database-backed or hosted acceptance. The existing PostgreSQL ingest regression suite must pass on an explicitly authorized test target before live OSF acceptance; it remains pending. Local PostgreSQL authentication remains parked.

## Existing endpoint

`POST https://supplier-portal-bi7h.vercel.app/api/integrations/cosmo/v1/requirement-imports`

Required headers:

```text
Content-Type: application/json
Authorization: Bearer <separately-approved development test token>
X-Contract-Version: cosmo-osf-push.v1
Idempotency-Key: osf-products-development-acceptance-001
```

The bearer credential determines the destination Portal company. The payload's source company must match that credential's source binding. Never substitute a production credential, reuse the Auth0 client secret, or embed a token in source, browser bundles or logs.

## Expected first import and replay

Before any hosted write, obtain explicit approval for the company-bound inbound test credential and this bounded synthetic transfer to development branch `br-morning-glade-b3odmb6e`, database `neondb`. Verify the exact target and that the fixture brand/SKUs/idempotency key are unused. If they already exist, inspect their ownership before proceeding; do not assume another new import should be created.

1. Submit the fixture once. Expect HTTP 201, one new brand, two product references, two matched import lines and one requirement with two items in **DRAFT**. Record the returned import/requirement IDs and the new brand/product IDs. The review link is `/staff/osf-imports/<importId>`.
2. Confirm quantities remain 2 and 3 and the requirement is still Draft. Check the created references belong only to the intended company. Missing ERP history must not block these valid OSF products.
3. Replay the exact same body and headers, including the original `sentAt`. Expect HTTP 200, `replay: true`, identical IDs and no additional business rows. Credential `lastUsedAt` may advance. Staff edits must not be reset by replay.
4. Reuse the key with a changed quantity. Expect HTTP 409 `IDEMPOTENCY_CONFLICT` and no business-row changes.
5. Verify that the synthetic Draft has not changed Supplier catalogue visibility. Catalogue activation requires an explicitly confirmed import and the existing SupplierBrand/exclusion rules.

Keep the fixture records identifiable and retain the returned IDs. Cleanup requires separate approval and must target only those recorded fixture IDs, preserve pre-existing rows/schema/constraints, and never reset the database. Do not create purchasing records merely to test import cleanup.

This acceptance does not authorize Cosmo production configuration changes, live OSF push, ERP/Shopify calls, credential provisioning, deployment or migrations. A manual authenticated synthetic test exercises the Portal endpoint without enabling Cosmo push.
