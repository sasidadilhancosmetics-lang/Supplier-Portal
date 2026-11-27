-- Stage 5B schema changes (development only after apply approval).
-- AvailabilityOfferStatus.NOT_AVAILABLE already exists — zero-qty responses use it; no enum change.

-- AlterEnum: draft requirement management (split from CONFIRM_REQUIREMENT)
-- Note: new enum value is not used in this migration (PG <15 cannot use it until commit).
ALTER TYPE "StaffPermissionCode" ADD VALUE 'MANAGE_REQUIREMENTS' BEFORE 'CONFIRM_REQUIREMENT';

-- AlterTable: optional response deadline (UTC) for supplier requests
ALTER TABLE "SupplierRequest" ADD COLUMN "responseDeadline" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SupplierRequest_companyId_responseDeadline_idx"
  ON "SupplierRequest"("companyId", "responseDeadline");
