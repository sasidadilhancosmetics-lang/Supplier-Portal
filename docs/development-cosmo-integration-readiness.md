# Production Cosmo read bindings for Portal development

Status: **proposal only, 25 November 2026**. No token, environment setting, deployment or live lookup was created by this preparation. Cosmo → Portal OSF push stays disabled.

## Verified identities and current configuration

| Role | Exact value |
| --- | --- |
| Portal development destination | `cmwbze3sbdec61b9a38ebfb8f` |
| Cosmo production source | `https://os.cosmetics.lk`, company `cmn2xcas1002crl5xtgoq28f5` |
| Media location | `cmr0ztcao0001l804fi3qox8i` |
| Shopify store/location | `u71ajc-11.myshopify.com` / `70434062401` |
| ERP1 | `cmr0zgv9e0003jp042b584n5b` → `Cosmetics.lk` |
| ERP2 | `cmqhp0p210001l804rcvp9w6f` → 12 company names below |

The owner supplied the company/location/ERP IDs through a whitelisted, authenticated Cosmo Settings export. Read-only Vercel metadata for production project `cosmo-os` (`prj_z9BAwowyqPkEzgOvXXJgFgF3HKQp`) listed 32 environment variables and **no `SUPPLIER_PORTAL_` keys**. Portal's ignored local `.env.local` and the current shell have neither `PORTAL_COSMO_PRODUCT_MEDIA_JSON` nor `PORTAL_COSMO_PURCHASE_HISTORY_JSON`. No values were printed or modified. Recheck names and target scopes immediately before a future write; stop if either key has appeared.

The exact ERP2 company allowlist is: `KAD Trading Lanka  (Pvt) Ltd`, `Udara Trading Lanka (Pvt) Ltd`, `USP Trading Lanka (Pvt) Ltd`, `DTD Trading (Pvt) Ltd`, `DRO Trading (Pvt) Ltd`, `LMJ International Lanka (Pvt) Ltd`, `MNK Trading Lanka (Pvt) Ltd`, `LWK Enterprises (Pvt) Ltd`, `AJS Trading Lanka (Pvt) Ltd`, `SPK Trading (Pvt) Ltd`, `Chami Trading Lanka (Pvt) Ltd`, `Pevi Trading Lanka (Pvt) Ltd`. Preserve the double space in the KAD name. The history route checks the selected ERP company against the binding and a same-company `CompanyLocation` for that instance, and returns one company per bounded lookup. ERP1's string binding remains compatible.

## Redacted configuration to review

Add only `SUPPLIER_PORTAL_PRODUCT_MEDIA_BINDING_JSON` to **Cosmo Vercel Production**, as one object:

```json
{"purpose":"product-media:read","destinationCompanyId":"cmwbze3sbdec61b9a38ebfb8f","companyId":"cmn2xcas1002crl5xtgoq28f5","locationId":"cmr0ztcao0001l804fi3qox8i","storeHostname":"u71ajc-11.myshopify.com","tokenHash":"<SHA256_MEDIA_TOKEN>","expiresAt":"<UTC_EXPIRY>"}
```

Add only `SUPPLIER_PORTAL_PURCHASE_HISTORY_BINDINGS_JSON` to **Cosmo Vercel Production**, keyed by the Portal destination:

```json
{"cmwbze3sbdec61b9a38ebfb8f":{"purpose":"purchase-history:read","companyId":"cmn2xcas1002crl5xtgoq28f5","tokenHash":"<SHA256_HISTORY_TOKEN>","expiresAt":"<UTC_EXPIRY>","erpCompanies":{"cmr0zgv9e0003jp042b584n5b":"Cosmetics.lk","cmqhp0p210001l804rcvp9w6f":["KAD Trading Lanka  (Pvt) Ltd","Udara Trading Lanka (Pvt) Ltd","USP Trading Lanka (Pvt) Ltd","DTD Trading (Pvt) Ltd","DRO Trading (Pvt) Ltd","LMJ International Lanka (Pvt) Ltd","MNK Trading Lanka (Pvt) Ltd","LWK Enterprises (Pvt) Ltd","AJS Trading Lanka (Pvt) Ltd","SPK Trading (Pvt) Ltd","Chami Trading Lanka (Pvt) Ltd","Pevi Trading Lanka (Pvt) Ltd"]}}}
```

Add only these two **server-only Portal development** keys, each keyed by `cmwbze3sbdec61b9a38ebfb8f`:

```text
PORTAL_COSMO_PRODUCT_MEDIA_JSON={"cmwbze3sbdec61b9a38ebfb8f":{"origin":"https://os.cosmetics.lk","approvedOrigin":"https://os.cosmetics.lk","token":"<MEDIA_TOKEN>","companyId":"cmn2xcas1002crl5xtgoq28f5","locationId":"cmr0ztcao0001l804fi3qox8i","storeHostname":"u71ajc-11.myshopify.com"}}
PORTAL_COSMO_PURCHASE_HISTORY_JSON={"cmwbze3sbdec61b9a38ebfb8f":{"origin":"https://os.cosmetics.lk","approvedOrigin":"https://os.cosmetics.lk","companyId":"cmn2xcas1002crl5xtgoq28f5","token":"<HISTORY_TOKEN>"}}
```

The two bearer tokens must differ and remain outside source control, docs, logs and browser responses; only their distinct lowercase SHA-256 hashes belong in Cosmo. Propose a 72-hour UTC expiry from activation. Shopify location ID `70434062401` belongs to the selected `CompanyLocation` and is checked through that record; it is **not** a field in the strict media binding schema. Never add it to the JSON. No Shopify Admin credential is needed for Cosmo-stored photos.

## Execution gates after explicit approval

1. Recheck the exact Vercel project, production alias/commit, and the four key names. Fail closed if an intended key already exists or a scope differs. Do not replace any of the 32 unrelated settings.
2. Tighten Portal `.env.local` access or use an owner-approved restricted secret store **before** writing bearer tokens. Current ACL permits broad local `Authenticated Users` modification and `Users` read access. Verify the development server still has access after the ACL change.
3. Generate two independent purpose-scoped tokens, compute hashes without printing tokens, choose matching 72-hour UTC expiries, validate both JSON values against the existing schemas, and add only the two Cosmo Production and two Portal development keys above. Do not set `SUPPLIER_PORTAL_BASE_URL`, `SUPPLIER_PORTAL_INTEGRATION_TOKEN`, or an inbound OSF credential.
4. Obtain separate approval for a production redeploy of the then-current reviewed Cosmo deployment. [Vercel environment changes apply only to new deployments](https://vercel.com/docs/environment-variables/managing-environment-variables). Merely adding the keys will not activate them on the existing deployment.
5. After activation, obtain separate approval for one exact-SKU read-only photo lookup and bounded ERP1/ERP2 history lookups. Use an approved ERP2 company and date range; call the read clients directly without Portal media refresh/import writes. Confirm source identity and provenance before wider UAT.

ERP provider read access is unresolved: the existing API users need GET/read on `Item`, `Purchase Invoice` and joined `Purchase Invoice Item` fields, including company-level read access for the 12 ERP2 names. Verify privileges through an owner-authorized configuration view or as part of a separately approved bounded live test. No provider call is authorized by this plan. Production purchase data may appear in development responses; restrict development access and retention.
