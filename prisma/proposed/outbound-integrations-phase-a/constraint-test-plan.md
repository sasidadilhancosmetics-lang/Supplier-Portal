# Phase A constraint test plan

Execution requires explicit approval for a named disposable development rehearsal branch. Use two synthetic companies on the approved branch and synthetic encrypted bundles. Record SQLSTATE and constraint names. Never include credentials, ciphertext, or connection strings in evidence.

| Case | Expected result |
| --- | --- |
| Insert disabled connection with no credential bundle | Accepted with version 1. |
| Create two ERPNext origins in one company | Both accepted. The same company, provider, and canonical origin is rejected with `23505`. The same origin in a second company is accepted. |
| Enable Shopify | Multiple disabled stores may exist. Two competing enables in the same company yield one success and one `23505` for the partial index. Another company can enable its own store. Verify that the first store can be disabled and the second enabled in that order in one transaction. |
| Company ownership | An unknown company is rejected with `23503`. The foreign key restricts deletion and key changes for a referenced company. |
| Credential bundle | An enabled row with all fields null, each partially populated bundle, a blank key ID, empty ciphertext, or a wrong nonce or tag length is rejected with `23514`. A complete valid bundle works with either enabled state. |
| Identity | An update changing ID, company, provider, or origin is rejected with `23514` and the trigger constraint name. Valid label, enabled state, credential rotation, and version edits succeed. |
| Basic field checks | Reject a blank or untrimmed label, a nonpositive version, a structurally invalid origin, and a Shopify origin outside the canonical hostname shape. Verify application destination rules separately. |
| Catalog and regression | Verify the enum, foreign key actions, CHECK definitions, partial index predicate, trigger, and function. Verify the migration changes only its new objects and the expected migration history. Compare schema metadata and approved non-sensitive aggregates for pre-existing Cosmo, order, delivery, and GRN data. |

Use transaction rollback and savepoints for fixture tests where possible. For the race test, coordinate two database sessions and keep all effects on the disposable rehearsal branch. Use the approved cleanup plan for any committed fixture.
