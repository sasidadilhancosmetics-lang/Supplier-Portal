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
-- CreateEnum
CREATE TYPE "OsfImportLineMappingStatus" AS ENUM ('MATCHED_SKU', 'UNKNOWN_SKU', 'AMBIGUOUS_SKU', 'UNKNOWN_BRAND', 'REJECTED_ZERO_QTY', 'REJECTED_INVALID_QTY', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "OsfImportDistributionStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'SKIPPED_ALREADY_REQUESTED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OsfImportStatus" ADD VALUE 'NEEDS_REVIEW';
ALTER TYPE "OsfImportStatus" ADD VALUE 'READY_TO_CONFIRM';
ALTER TYPE "OsfImportStatus" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "OsfImport" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "contractVersion" TEXT,
ADD COLUMN     "integrationCredentialId" TEXT,
ADD COLUMN     "payloadHash" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OsfImportLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "osfImportId" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "cosmoVendorId" TEXT,
    "brandNameSnapshot" TEXT NOT NULL,
    "erp1Priority" TEXT,
    "erp2Priority" TEXT,
    "quantityProposed" DECIMAL(18,4) NOT NULL,
    "quantityPlanned" DECIMAL(18,4) NOT NULL,
    "mappingStatus" "OsfImportLineMappingStatus" NOT NULL,
    "brandId" TEXT,
    "productId" TEXT,
    "requirementId" TEXT,
    "requirementItemId" TEXT,
    "resolutionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsfImportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsfImportDistribution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "osfImportId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "status" "OsfImportDistributionStatus" NOT NULL,
    "claimToken" TEXT,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "supplierRequestIds" JSONB,
    "alreadyRequestedSupplierIds" JSONB,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsfImportDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cosmoCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OsfImportLine_requirementItemId_key" ON "OsfImportLine"("requirementItemId");

-- CreateIndex
CREATE INDEX "OsfImportLine_companyId_osfImportId_idx" ON "OsfImportLine"("companyId", "osfImportId");

-- CreateIndex
CREATE INDEX "OsfImportLine_osfImportId_mappingStatus_idx" ON "OsfImportLine"("osfImportId", "mappingStatus");

-- CreateIndex
CREATE INDEX "OsfImportLine_osfImportId_brandId_idx" ON "OsfImportLine"("osfImportId", "brandId");

-- CreateIndex
CREATE INDEX "OsfImportLine_requirementId_idx" ON "OsfImportLine"("requirementId");

-- CreateIndex
CREATE INDEX "OsfImportLine_productId_idx" ON "OsfImportLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImportLine_osfImportId_lineKey_key" ON "OsfImportLine"("osfImportId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImportLine_osfImportId_sourceIndex_key" ON "OsfImportLine"("osfImportId", "sourceIndex");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_companyId_status_idx" ON "OsfImportDistribution"("companyId", "status");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_osfImportId_status_idx" ON "OsfImportDistribution"("osfImportId", "status");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_requirementId_idx" ON "OsfImportDistribution"("requirementId");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_status_claimExpiresAt_idx" ON "OsfImportDistribution"("status", "claimExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImportDistribution_osfImportId_requirementId_key" ON "OsfImportDistribution"("osfImportId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_tokenHash_key" ON "IntegrationCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "IntegrationCredential_companyId_cosmoCompanyId_isActive_idx" ON "IntegrationCredential"("companyId", "cosmoCompanyId", "isActive");

-- CreateIndex
CREATE INDEX "OsfImport_integrationCredentialId_idx" ON "OsfImport"("integrationCredentialId");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImport_id_companyId_key" ON "OsfImport"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_osfImportId_brandId_key" ON "Requirement"("osfImportId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_id_companyId_key" ON "Requirement"("id", "companyId");

-- AddForeignKey
ALTER TABLE "OsfImport" ADD CONSTRAINT "OsfImport_integrationCredentialId_fkey" FOREIGN KEY ("integrationCredentialId") REFERENCES "IntegrationCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImport" ADD CONSTRAINT "OsfImport_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_osfImportId_companyId_fkey" FOREIGN KEY ("osfImportId", "companyId") REFERENCES "OsfImport"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_requirementItemId_fkey" FOREIGN KEY ("requirementItemId") REFERENCES "RequirementItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_osfImportId_companyId_fkey" FOREIGN KEY ("osfImportId", "companyId") REFERENCES "OsfImport"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_requirementId_companyId_fkey" FOREIGN KEY ("requirementId", "companyId") REFERENCES "Requirement"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- <<< GENERATED END

-- [custom] CHECK constraints. Prisma does not model CHECKs; names are listed in
-- docs/decisions.md and asserted by the post-apply verification.

ALTER TABLE "OsfImport"
  ADD CONSTRAINT "OsfImport_version_positive_chk" CHECK ("version" >= 1),
  -- Compared as text: 'CONFIRMED' was added to the enum in this transaction
  -- and cannot be used as an enum literal before COMMIT.
  ADD CONSTRAINT "OsfImport_confirmed_fields_chk" CHECK (
    "status"::text <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  );

ALTER TABLE "OsfImportLine"
  ADD CONSTRAINT "OsfImportLine_sourceIndex_nonneg_chk" CHECK ("sourceIndex" >= 0),
  ADD CONSTRAINT "OsfImportLine_quantityProposed_nonneg_chk" CHECK ("quantityProposed" >= 0),
  ADD CONSTRAINT "OsfImportLine_quantityPlanned_nonneg_chk" CHECK ("quantityPlanned" >= 0),
  ADD CONSTRAINT "OsfImportLine_version_positive_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "OsfImportLine_matched_requires_product_chk" CHECK (
    "mappingStatus" <> 'MATCHED_SKU' OR ("productId" IS NOT NULL AND "brandId" IS NOT NULL)
  ),
  ADD CONSTRAINT "OsfImportLine_item_link_chk" CHECK (
    "requirementItemId" IS NULL
    OR ("productId" IS NOT NULL AND "requirementId" IS NOT NULL AND "quantityPlanned" > 0)
  );

ALTER TABLE "OsfImportDistribution"
  ADD CONSTRAINT "OsfImportDistribution_attemptCount_nonneg_chk" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "OsfImportDistribution_version_positive_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "OsfImportDistribution_in_progress_claim_chk" CHECK (
    "status" <> 'IN_PROGRESS'
    OR ("claimToken" IS NOT NULL AND "claimedAt" IS NOT NULL AND "claimExpiresAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "OsfImportDistribution_terminal_no_claim_chk" CHECK (
    "status" = 'IN_PROGRESS' OR "claimToken" IS NULL
  ),
  -- CASE guards jsonb_array_length: AND operands have no guaranteed evaluation order.
  ADD CONSTRAINT "OsfImportDistribution_succeeded_fields_chk" CHECK (
    "status" <> 'SUCCEEDED'
    OR ("completedAt" IS NOT NULL
        AND CASE WHEN jsonb_typeof("supplierRequestIds") = 'array'
                 THEN jsonb_array_length("supplierRequestIds") > 0
                 ELSE false END)
  ),
  ADD CONSTRAINT "OsfImportDistribution_skipped_fields_chk" CHECK (
    "status" <> 'SKIPPED_ALREADY_REQUESTED'
    OR ("completedAt" IS NOT NULL
        AND CASE WHEN jsonb_typeof("alreadyRequestedSupplierIds") = 'array'
                 THEN jsonb_array_length("alreadyRequestedSupplierIds") > 0
                 ELSE false END
        AND ("supplierRequestIds" IS NULL OR "supplierRequestIds" = '[]'::jsonb))
  ),
  ADD CONSTRAINT "OsfImportDistribution_failed_fields_chk" CHECK (
    "status" <> 'FAILED' OR "lastError" IS NOT NULL
  );

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_revoked_inactive_chk" CHECK ("revokedAt" IS NULL OR "isActive" = false);

COMMIT;
