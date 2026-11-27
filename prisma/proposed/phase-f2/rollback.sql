-- =============================================================================
-- REVIEW ONLY — Phase F2 rollback. Do not run without explicit approval.
-- Safe only before F2 is relied upon in development workflows.
-- Does not touch PurchaseOrder / Requirement / existing Supplier row data
-- (only drops the new unique index on externalId).
-- =============================================================================

BEGIN;

ALTER TABLE "OsfRequestSuggestion"
  DROP CONSTRAINT IF EXISTS "OsfRequestSuggestion_supplierId_companyId_fkey";
ALTER TABLE "OsfRequestSuggestion"
  DROP CONSTRAINT IF EXISTS "OsfRequestSuggestion_line_quad_fkey";
ALTER TABLE "OsfRequestSuggestion"
  DROP CONSTRAINT IF EXISTS "OsfRequestSuggestion_osfImportId_companyId_fkey";
ALTER TABLE "OsfRequestSuggestion"
  DROP CONSTRAINT IF EXISTS "OsfRequestSuggestion_companyId_fkey";

DROP TABLE IF EXISTS "OsfRequestSuggestion";

DROP TYPE IF EXISTS "OsfRequestSuggestionMappingStatus";

DROP INDEX IF EXISTS "Supplier_companyId_externalId_key";
DROP INDEX IF EXISTS "OsfImportLine_id_osfImportId_companyId_lineKey_key";
DROP INDEX IF EXISTS "OsfImportLine_id_osfImportId_companyId_key";
DROP INDEX IF EXISTS "OsfImportLine_id_companyId_key";

COMMIT;
