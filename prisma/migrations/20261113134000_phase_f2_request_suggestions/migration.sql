-- =============================================================================
-- REVIEW ONLY — DO NOT APPLY WITHOUT EXPLICIT APPROVAL.
-- Phase F2: OsfRequestSuggestion + OsfImportLine composite uniques +
--           Supplier (companyId, externalId) uniqueness for Cosmo Supplier.id.
-- Target after approval: Neon development (br-morning-glade-b3odmb6e),
-- after rehearsal on a disposable child branch.
-- Never production (br-fancy-voice-b33wenqw).
-- Planned live folder (only after approval):
--   prisma/migrations/YYYYMMDDHHMMSS_phase_f2_request_suggestions/
--
-- Safety properties:
--   - Additive only (CREATE TYPE/TABLE/INDEX/CONSTRAINT). No DROP of business data.
--   - No UPDATE/DELETE on Supplier, OsfImportLine, PurchaseOrder, or Requirement.
--   - Quad FK (lineId, importId, companyId, lineKey) forces one consistent line row.
--   - Optional supplier FK is company-scoped; NULL supplierId skips FK (MATCH SIMPLE).
-- =============================================================================

BEGIN;

-- [custom] Preflight: abort if data would block new uniques / integrity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Supplier"
    WHERE "externalId" IS NOT NULL
    GROUP BY "companyId", "externalId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Phase F2 preflight: duplicate (companyId, externalId) on Supplier; resolve before unique.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OsfImportLine" l
    JOIN "OsfImport" i ON i.id = l."osfImportId"
    WHERE l."companyId" <> i."companyId"
  ) THEN
    RAISE EXCEPTION
      'Phase F2 preflight: OsfImportLine.companyId mismatch vs parent OsfImport.';
  END IF;
END $$;

-- Approved OsfImportLine composite uniques (id is already PK → indexes are safe).
CREATE UNIQUE INDEX IF NOT EXISTS "OsfImportLine_id_companyId_key"
  ON "OsfImportLine" (id, "companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "OsfImportLine_id_osfImportId_companyId_key"
  ON "OsfImportLine" (id, "osfImportId", "companyId");

-- Hardening: bind denormalized lineKey to the same line row as osfImportLineId.
CREATE UNIQUE INDEX IF NOT EXISTS "OsfImportLine_id_osfImportId_companyId_lineKey_key"
  ON "OsfImportLine" (id, "osfImportId", "companyId", "lineKey");

-- Supplier.externalId = Cosmo Supplier.id (nullable).
-- PostgreSQL UNIQUE treats NULLs as distinct → multiple NULL externalId allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_companyId_externalId_key"
  ON "Supplier" ("companyId", "externalId");

CREATE TYPE "OsfRequestSuggestionMappingStatus" AS ENUM (
  'MATCHED_SUPPLIER',
  'UNRESOLVED_SUPPLIER',
  'INELIGIBLE_BRAND',
  'LINE_NOT_ACTIONABLE'
);

CREATE TABLE "OsfRequestSuggestion" (
  id TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "osfImportId" TEXT NOT NULL,
  "osfImportLineId" TEXT NOT NULL,
  "lineKey" TEXT NOT NULL,
  "cosmoSupplierId" TEXT NOT NULL,
  "cosmoSupplierCode" TEXT,
  "cosmoSupplierName" TEXT NOT NULL,
  "suggestedRequestQty" DECIMAL(18,4) NOT NULL,
  "supplierId" TEXT,
  "mappingStatus" "OsfRequestSuggestionMappingStatus" NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "warningFlags" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OsfRequestSuggestion_pkey" PRIMARY KEY (id),
  CONSTRAINT "OsfRequestSuggestion_qty_positive_chk"
    CHECK ("suggestedRequestQty" > 0),
  CONSTRAINT "OsfRequestSuggestion_mapping_supplier_chk" CHECK (
    (
      "mappingStatus" = 'MATCHED_SUPPLIER'
      AND "supplierId" IS NOT NULL
    )
    OR (
      "mappingStatus" = 'UNRESOLVED_SUPPLIER'
      AND "supplierId" IS NULL
    )
    OR (
      "mappingStatus" = 'INELIGIBLE_BRAND'
      AND "supplierId" IS NOT NULL
    )
    OR (
      "mappingStatus" = 'LINE_NOT_ACTIONABLE'
    )
  )
);

CREATE UNIQUE INDEX "OsfRequestSuggestion_osfImportId_osfImportLineId_cosmoSupplierId_key"
  ON "OsfRequestSuggestion" ("osfImportId", "osfImportLineId", "cosmoSupplierId");

CREATE INDEX "OsfRequestSuggestion_companyId_osfImportId_idx"
  ON "OsfRequestSuggestion" ("companyId", "osfImportId");

CREATE INDEX "OsfRequestSuggestion_osfImportId_mappingStatus_idx"
  ON "OsfRequestSuggestion" ("osfImportId", "mappingStatus");

CREATE INDEX "OsfRequestSuggestion_supplierId_idx"
  ON "OsfRequestSuggestion" ("supplierId");

CREATE INDEX "OsfRequestSuggestion_lineKey_idx"
  ON "OsfRequestSuggestion" ("lineKey");

ALTER TABLE "OsfRequestSuggestion"
  ADD CONSTRAINT "OsfRequestSuggestion_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OsfRequestSuggestion"
  ADD CONSTRAINT "OsfRequestSuggestion_osfImportId_companyId_fkey"
  FOREIGN KEY ("osfImportId", "companyId")
  REFERENCES "OsfImport"(id, "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- One FK: line id + import + company + lineKey must resolve to a single line row.
ALTER TABLE "OsfRequestSuggestion"
  ADD CONSTRAINT "OsfRequestSuggestion_line_quad_fkey"
  FOREIGN KEY ("osfImportLineId", "osfImportId", "companyId", "lineKey")
  REFERENCES "OsfImportLine"(id, "osfImportId", "companyId", "lineKey")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OsfRequestSuggestion"
  ADD CONSTRAINT "OsfRequestSuggestion_supplierId_companyId_fkey"
  FOREIGN KEY ("supplierId", "companyId")
  REFERENCES "Supplier"(id, "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
