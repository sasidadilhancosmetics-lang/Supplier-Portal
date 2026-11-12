/**
 * Future Cosmo OS → Supplier Portal integration boundary (Stage 5A contract only).
 *
 * Planned flow:
 *   Cosmo OS → Send to Supplier Portal → Draft Requirement → Staff Review → Confirm
 *
 * This module intentionally does NOT implement HTTP handlers or invent an OSF
 * payload schema. See docs/requirements-management.md.
 */

import type { CreateDraftRequirementInput } from "./schema";

/**
 * Opaque envelope the portal will eventually accept from Cosmo OS.
 * Fields beyond `idempotencyKey` / `payload` remain undefined until the
 * real OSF contract is documented.
 */
export type CosmoOsfInboundEnvelope = {
  /** Stable key for OsfImport.idempotencyKey (company-scoped unique). */
  idempotencyKey: string;
  /** Opaque JSON — do not interpret structure in Stage 5A. */
  payload: unknown;
  externalId?: string;
};

/**
 * Result of mapping an inbound OSF payload into a draft requirement input.
 * Implemented later once Cosmo OS documents the payload.
 */
export type CosmoOsfMappedDraft = {
  draft: CreateDraftRequirementInput;
  /** Persisted OsfImport id after RECEIVED/PROCESSED handling. */
  osfImportId: string;
};

/**
 * Placeholder: map Cosmo OS payload → draft requirement input.
 * Throws until the contract exists — callers must not invent mappings.
 */
export function mapCosmoOsfPayloadToDraft(
  envelope: CosmoOsfInboundEnvelope,
): never {
  void envelope;
  throw new Error(
    "Cosmo OS OSF payload mapping is not implemented. Contract unresolved.",
  );
}
