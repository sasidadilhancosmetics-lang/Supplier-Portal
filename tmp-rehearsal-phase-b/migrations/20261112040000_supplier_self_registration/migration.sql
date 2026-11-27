-- AlterEnum
ALTER TYPE "SupplierStatus" ADD VALUE 'REJECTED';

-- CreateEnum
CREATE TYPE "SupplierRegistrationSource" AS ENUM ('ADMIN', 'SELF');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "registrationSource" "SupplierRegistrationSource" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "Supplier" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "reviewedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_companyId_registrationSource_status_idx" ON "Supplier"("companyId", "registrationSource", "status");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
