-- CreateEnum
CREATE TYPE "OsfImportLineMappingStatus" AS ENUM ('MATCHED_SKU', 'UNKNOWN_SKU', 'AMBIGUOUS_SKU', 'UNKNOWN_BRAND', 'REJECTED_ZERO_QTY', 'REJECTED_INVALID_QTY', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "OsfImportDistributionStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'FAILED');

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
ADD COLUMN     "payloadHash" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OsfImportLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "osfImportId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "cosmoVendorId" TEXT,
    "brandNameSnapshot" TEXT NOT NULL,
    "brandId" TEXT,
    "productId" TEXT,
    "requirementId" TEXT,
    "requirementItemId" TEXT,
    "quantityPlanned" DECIMAL(18,4) NOT NULL,
    "erp1Priority" TEXT,
    "erp2Priority" TEXT,
    "mappingStatus" "OsfImportLineMappingStatus" NOT NULL,
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
    "brandId" TEXT NOT NULL,
    "status" "OsfImportDistributionStatus" NOT NULL,
    "attemptId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "responseJson" JSONB,
    "errorMessage" TEXT,
    "distributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsfImportDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cosmoCompanyId" TEXT NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
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
CREATE INDEX "OsfImportDistribution_osfImportId_status_idx" ON "OsfImportDistribution"("osfImportId", "status");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_companyId_osfImportId_idx" ON "OsfImportDistribution"("companyId", "osfImportId");

-- CreateIndex
CREATE INDEX "OsfImportDistribution_requirementId_idx" ON "OsfImportDistribution"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "OsfImportDistribution_osfImportId_requirementId_key" ON "OsfImportDistribution"("osfImportId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_tokenHash_key" ON "IntegrationCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "IntegrationCredential_companyId_cosmoCompanyId_isActive_idx" ON "IntegrationCredential"("companyId", "cosmoCompanyId", "isActive");

-- CreateIndex
CREATE INDEX "IntegrationCredential_companyId_isActive_idx" ON "IntegrationCredential"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "IntegrationCredential_cosmoCompanyId_isActive_idx" ON "IntegrationCredential"("cosmoCompanyId", "isActive");

-- CreateIndex
CREATE INDEX "OsfImport_companyId_payloadHash_idx" ON "OsfImport"("companyId", "payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_osfImportId_brandId_key" ON "Requirement"("osfImportId", "brandId");

-- AddForeignKey
ALTER TABLE "OsfImport" ADD CONSTRAINT "OsfImport_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportLine" ADD CONSTRAINT "OsfImportLine_osfImportId_fkey" FOREIGN KEY ("osfImportId") REFERENCES "OsfImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_osfImportId_fkey" FOREIGN KEY ("osfImportId") REFERENCES "OsfImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsfImportDistribution" ADD CONSTRAINT "OsfImportDistribution_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
