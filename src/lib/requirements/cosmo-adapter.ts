/**
 * Cosmo OS → Supplier Portal OSF integration boundary.
 *
 * Ingest implementation: `src/lib/integrations/cosmo/` +
 * `POST /api/integrations/cosmo/v1/requirement-imports` (Phase C1).
 *
 * Import Review UI, batch confirm, and Cosmo send remain later phases.
 */
export {
  COSMO_OSF_CONTRACT_VERSION,
  COSMO_OSF_MAX_ITEMS,
  COSMO_OSF_MAX_REQUEST_SUGGESTIONS,
  osfImportReviewPath,
} from "@/lib/integrations/cosmo/constants";
export { ingestCosmoOsfRequirementImport } from "@/lib/integrations/cosmo/ingest";
export type { CosmoIngestSuccessResponse } from "@/lib/integrations/cosmo/response";
export {
  canonicalOsfPushPayload,
  hashOsfPushPayload,
  parseCosmoOsfPushPayload,
  type CosmoOsfPushPayload,
} from "@/lib/integrations/cosmo/schema";
