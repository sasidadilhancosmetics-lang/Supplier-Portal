<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Supplier Portal and Cosmo OS development

Continue the existing projects directly in Codex. Read [current project status](docs/project-status.md) before planning work, and update it after meaningful implementation or validation. Keep status concise and distinguish local verification from hosted acceptance.

Reuse the applicable skills under `.cursor/skills/`: `supplier-portal-architecture`, `auth-supplier-isolation`, `prisma-neon-safety`, `ui-ux-performance`, and `feature-dev-qa`. Their linked domain documents remain the source of business rules. Read applicable Cursor rules explicitly.

Supplier does the minimum. Company handles the complexity. Preserve tenant isolation, negotiated prices, PO snapshots, company-owned receiving, GRNs, and Cosmo integration contracts.

Product source: Shopify → ERP1/ERP2 → Cosmo OS → OSF → Supplier Portal. Every Portal Product reference originates from an authenticated Cosmo OSF import; Admin, Staff, and Suppliers do not create products manually. OSF receipt creates or refreshes unambiguous company-scoped references and keeps requirements in Draft review until authorized confirmation. The Supplier Catalogue uses only the latest confirmed OSF, explicit SupplierBrand selections, and Admin SKU exclusions. Product photos use Cosmo's stored Shopify mapping. ERP purchase history is optional company-side decision support; missing ERP Item or history matches must never block valid OSF products. Keep OSF push disabled until separately approved.

Work autonomously within approved local implementation and testing scope, preserving unrelated changes. Continue through recoverable failures and routine next steps within that scope. Do not ask the owner to relay reports to another chat.

Obtain task-specific approval for hosted writes, migrations, production access, credential changes, or live external integrations. Existing tests are not authorization for rollout. Recovery work is postponed except the prepared one-time development backup. Key generation, Neon connections, backup execution, and restores each require specific approval. A completed read-only preflight does not authorize another connection.

Preserve this framework-managed block and existing guidance when updating instructions. Store no secrets in instructions or status records.

## Efficient local development

Use AGENTS.md and docs/project-status.md for context, then inspect only files relevant to the task. Avoid repeating completed investigations or validation. Use Low or Medium reasoning for straightforward work and reserve High for complex bugs, security, and architecture. Run focused tests for changed code; run the full suite at meaningful milestones or when necessary. Keep plans and responses concise, covering completed work, test results, blockers, and the next action. Continue approved local work autonomously while preserving sensitive-action approval requirements. Stop repeated attempts against an unchanged environmental blocker and prioritize working features over unrelated tooling investigations.
