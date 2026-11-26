# Phase A authenticated Admin Integrations UAT

20 November 2026 · **Preflight, anonymous access and authenticated Supplier denial passed. Authenticated Admin UAT is awaiting an authorized Admin session.**

## Target and write boundary

| Case | Result | Evidence |
| --- | --- | --- |
| Neon project and development branch | PASS | Neon metadata confirmed project `holy-art-38015209` and branch `br-morning-glade-b3odmb6e`. |
| Effective local build database target | PASS | Next.js environment resolution matched the pooled application URL and direct verification URL to development endpoint `ep-little-credit-b35km102` and the same database. |
| Phase A build | PASS | The existing Next.js build manifest contains `/admin/settings/integrations` and `/admin/settings/integrations/[id]`. The build was served from the local listener on `127.0.0.1:3000`. |
| Required tables | PASS | `OutboundIntegrationConnection` and `IntegrationCredential` exist. |
| Migration baseline | PASS | Eleven successful migrations, including `20261120120000_phase_a_outbound_integrations` with the recorded checksum matching the local file. |
| PriceAgreement composite supplier FK | PASS | PostgreSQL reports a validated FK from `(availabilityOfferId, supplierId)` to `AvailabilityOffer(id, supplierId)`. |
| Automatic writes expected from the planned routes | PASS, source review | `getAuthState()` updates `lastLoginAt` on `User` and `ExternalIdentity`. Prisma also updates `updatedAt` on both models. The resumed UAT authorizes these four fields only during normal authentication for existing authorized test identities. Neon showed zero user-defined triggers on those tables. The Auth0 middleware uses the default SDK client without application callback hooks. The Integrations reads, shared header, guards and planned regression index loaders were reviewed. The allocation flow can expire offers during loading and was kept out of the smoke check. |

The browser reached the normal identity-provider login screen from the protected route. The signed-in portal resolved the test session to the Supplier role. The database snapshots ran in read-only transactions against development. Production, provider connections and integration actions were untouched.

## Database comparison after anonymous and Supplier browser activity

Fingerprints aggregate hashes of complete rows ordered by ID. The counts and fingerprints below matched before and after the anonymous and Supplier browser checks. A separate comparison also found matching fingerprints across all 34 non-identity public tables.

| Table | Rows | Fingerprint |
| --- | ---: | --- |
| `OutboundIntegrationConnection` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `IntegrationCredential` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `AuditLog` | 71 | `f51682100ea761c794e33f6c1cae6528` |
| `PurchaseOrder` | 2 | `588e657c2bda7fe61bd9753d5b79a847` |
| `Delivery` | 5 | `bcf39b1701f987607f6c544024985506` |
| `Grn` | 5 | `71224eeb3c7d5464c58c300dd030d7c5` |
| `_prisma_migrations` | 11 | `d52ee172e85b0c9364b7c90d2a6557b8` |

The pseudonymized comparison covered 10 `User` and `ExternalIdentity` rows combined. Anonymous browser activity changed no identity timestamps. After the Supplier session, `lastLoginAt` and `updatedAt` advanced on one Supplier `User` and one Supplier `ExternalIdentity`. No other identity fields or rows changed. The exact validated `PriceAgreement` FK definition also matched. The Admin-session comparison remains **NOT TESTED**. No personal identifiers or individual timestamp values are published here.

## Browser cases

| Case | Result | Evidence or reason |
| --- | --- | --- |
| Active company Admin identity, Integrations navigation and route | NOT TESTED | Awaiting sign-in with an existing authorized test Admin. |
| Company Staff denial | NOT TESTED in authenticated browser | No Staff session used. Focused service fixture PASS for denial. |
| Supplier denial | Authenticated browser PASS | The active Supplier session was returned to its dashboard when opening Admin Integrations. Integrations content was absent. |
| Anonymous redirect or denial | Browser PASS | Integrations content did not render. The streamed HTTP response carried the `/auth/login` redirect and the browser reached the identity-provider login form. The server logged the expected `UNAUTHENTICATED` denial. |
| Cross-company isolation | Service fixture PASS. Authenticated browser NOT TESTED | Seven focused service tests passed using synthetic data and mocked dependencies. They exercised company-scoped listing projections and rejection of a foreign connection ID. No cross-company browser context was used. |
| ERPNext and Shopify empty states | NOT TESTED in authenticated browser | The database has zero outbound rows. Earlier Stage 1 mock fixture PASS for both empty states. |
| Cosmo OS inbound read-only | NOT TESTED in authenticated browser | The database has zero inbound credential rows. Earlier Stage 1 mock fixture PASS for display-only metadata. |
| Live connectivity and mock wording | NOT TESTED in authenticated browser | The listing states tests run in mock mode. Live connectivity wording is rendered for configured rows. Earlier Stage 1 configured mock fixture verified the live status separately from the mock result. |
| Secret exposure in DOM, responses and logs | NOT TESTED in authenticated browser | The anonymous protected-route HTTP response did not include connection strings or outbound credential payload field markers. Authenticated payload and log checks remain pending. |
| Console, failed requests, and server errors | Anonymous check completed | One auth-related browser console error entry appeared during the redirect. The local server logged `UNAUTHENTICATED`; the redirect completed and no browser resource-load error was captured. Authenticated diagnostics and screenshots remain pending. |
| Admin dashboard and staff purchasing regressions | NOT TESTED | No authorized sessions used. |
| Supplier dashboard | Authenticated browser PASS | Dashboard rendered with a signed-in Supplier session. |
| Supplier requests, orders and deliveries indexes | FAIL, smoke navigation | Direct browser visits returned to the Supplier dashboard instead of leaving the requested list visible. No generic application error appeared. The cause is unconfirmed. |

### Responsive matrix

The authenticated checks cover overflow, section legibility, header and drawer, practical touch targets, sticky obstruction, keyboard focus and tab order, status wording, and rendered secrets.

| Width | Authenticated browser | Earlier Stage 1 fixture layout |
| ---: | --- | --- |
| 320px | NOT TESTED | Mock fixture PASS |
| 360px | NOT TESTED | Mock fixture PASS |
| 375px | NOT TESTED | Mock fixture PASS |
| 390px | NOT TESTED | Mock fixture PASS |
| 430px | NOT TESTED | Mock fixture PASS |
| 768px | NOT TESTED | Mock fixture PASS |
| 1280px | NOT TESTED | Mock fixture PASS |

Physical Android Chrome and iPhone Safari remain **UNVERIFIED**.

## Remaining blocker

An existing authorized Company Admin needs to sign in through the normal browser tab. Staff and Supplier browser checks also depend on authorized sessions for those roles. The approved write scope already covers the four normal authentication timestamps.

Complete authenticated UAT and compare the database snapshots before requesting separate approval for Stage 2 synthetic integration writes.
