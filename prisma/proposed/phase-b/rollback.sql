-- =============================================================================
-- REVIEW ONLY — manual reverse of the Phase B migration on Neon DEVELOPMENT.
-- Preferred recovery is restoring the pre-migration Neon backup branch, not this.
-- Use only if the backup branch is unavailable AND the new tables hold no data
-- that must be kept. Afterwards mark the migration rolled back:
--   npx prisma migrate resolve --rolled-back 20261112120000_phase_b_osf_import_review
--
-- Enum values NEEDS_REVIEW / READY_TO_CONFIRM / CONFIRMED on "OsfImportStatus"
-- are intentionally left in place (PostgreSQL cannot drop enum values safely).
-- The application must not write them while the schema is rolled back.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OsfImportLine")
     OR EXISTS (SELECT 1 FROM "OsfImportDistribution")
     OR EXISTS (SELECT 1 FROM "IntegrationCredential")
     OR EXISTS (SELECT 1 FROM "OsfImport") THEN
    RAISE EXCEPTION 'Rollback refused: Phase B tables or OsfImport contain rows. Restore the backup branch instead.';
  END IF;
END $$;

DROP TABLE IF EXISTS "OsfImportDistribution";
DROP TABLE IF EXISTS "OsfImportLine";

ALTER TABLE "OsfImport" DROP CONSTRAINT IF EXISTS "OsfImport_integrationCredentialId_fkey";
ALTER TABLE "OsfImport" DROP CONSTRAINT IF EXISTS "OsfImport_confirmedById_fkey";
ALTER TABLE "OsfImport" DROP CONSTRAINT IF EXISTS "OsfImport_version_positive_chk";
ALTER TABLE "OsfImport" DROP CONSTRAINT IF EXISTS "OsfImport_confirmed_fields_chk";
DROP INDEX IF EXISTS "OsfImport_integrationCredentialId_idx";
DROP INDEX IF EXISTS "OsfImport_id_companyId_key";

DROP TABLE IF EXISTS "IntegrationCredential";

ALTER TABLE "OsfImport"
  DROP COLUMN IF EXISTS "confirmedAt",
  DROP COLUMN IF EXISTS "confirmedById",
  DROP COLUMN IF EXISTS "contractVersion",
  DROP COLUMN IF EXISTS "integrationCredentialId",
  DROP COLUMN IF EXISTS "payloadHash",
  DROP COLUMN IF EXISTS "version";

DROP INDEX IF EXISTS "Requirement_osfImportId_brandId_key";
DROP INDEX IF EXISTS "Requirement_id_companyId_key";

DROP TYPE IF EXISTS "OsfImportDistributionStatus";
DROP TYPE IF EXISTS "OsfImportLineMappingStatus";

COMMIT;
