# Phase A security test plan

Use synthetic fixtures and a mock transport with outbound network disabled. No stored provider credentials are required for mock connection tests.

| Area | Required checks |
| --- | --- |
| Authorization | Same-company active admins can manage their own settings. Staff, suppliers, inactive users, and another company's admins cannot read, test, update, or see history for a connection. Company scope and actor identity come from the session. |
| Secret handling | The admin can replace a credential and can only read its configured state and replacement date. Verify page props, action results, errors, audit metadata, Prisma debug output, and telemetry contain no plaintext, ciphertext, provider body, or headers. |
| Encryption and rotation | Round-trip synthetic AES-256-GCM records. Reject a missing key, a modified tag, and a valid record copied to the wrong company, row, provider, or origin. Test keyring overlap and stale-version handling during re-encryption. Provider credential replacement and key rotation use separate workflows. |
| Destination validation | Verify the company-specific ERP HTTPS origin allowlist and canonical Shopify store hostname policy. Reject unexpected ports, URL components, hosts, and unapproved destinations. Any future live transport needs its own egress, connection-time address validation, redirect, TLS, timeout, and response-size tests. |
| Mock behavior | Assert zero network calls and zero stored credential loads or decryptions. Simulate provider success and failure, label the result as mocked, and retain the tested configuration version. The UI keeps live state unverified even when enabled and after a mock pass. |
| Cosmo inbound | Preserve existing token hashing, tenant binding, expiry, revocation, and replay behavior. The new UI shows only safe inbound metadata. |

## Decisions before handling real credentials

Confirm the server hosting platform and secret store, the operator and runtime identity that may read keys, dev and production key separation, version and backup retention, rotation and incident procedures, and the documented exception for encrypted provider credentials in Neon. Keep keys outside Neon, code, audit records, and report artifacts. Confirm ERP network boundaries and Shopify app ownership and grant flow before any live-provider review.
