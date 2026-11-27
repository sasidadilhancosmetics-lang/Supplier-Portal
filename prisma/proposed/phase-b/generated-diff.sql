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
