-- =============================================================================
-- REVIEW ONLY — DO NOT APPLY WITHOUT EXPLICIT APPROVAL.
-- Phase B: OSF import review, distribution ledger, integration credentials.
-- Target after approval: Neon project holy-art-38015209, branch development
-- (br-morning-glade-b3odmb6e), after a rehearsal on a disposable child branch.
-- Never production (br-fancy-voice-b33wenqw).
-- Planned folder: prisma/migrations/20261112120000_phase_b_osf_import_review/
--
-- Layout:
--   [custom]    explicit BEGIN + preflight guard
--   [generated] verbatim `prisma migrate diff` output (do not edit by hand)
--   [custom]    CHECK constraints + COMMIT
--
-- Explicit BEGIN/COMMIT is required: Prisma 7.4+ may apply PostgreSQL
-- migration statements individually (prisma/orm#30640). Every statement here
-- is transaction-safe (no CONCURRENTLY, no VACUUM). ALTER TYPE ... ADD VALUE
-- is allowed inside a transaction block on PostgreSQL 12+ (server is 18.6);
-- the new values are not used as enum literals before COMMIT.
-- =============================================================================

BEGIN;

-- [custom] Preflight guard: aborts the transaction, changes nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OsfImport") THEN
    RAISE EXCEPTION 'Phase B preflight: OsfImport has rows; payloadHash NOT NULL needs a backfill plan first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Requirement"
    WHERE "osfImportId" IS NOT NULL
    GROUP BY "osfImportId", "brandId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase B preflight: duplicate (osfImportId, brandId) requirements exist.';
  END IF;
END $$;

-- >>> GENERATED BEGIN (prisma migrate diff --from-schema prisma/schema.prisma --to-schema prisma/proposed/phase-b/schema.prisma --script)
