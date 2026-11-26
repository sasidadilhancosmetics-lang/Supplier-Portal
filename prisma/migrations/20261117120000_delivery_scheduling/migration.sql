-- Delivery scheduling & company receipt (additive).
-- Neon development only. Does not UPDATE/DELETE existing Delivery or Grn rows.
-- Enum ADD VALUE only; status-aware CHECKs are in the next migration.

-- ---------------------------------------------------------------------------
-- 1) Enum: additive values only (existing SUBMITTED / VERIFIED / REJECTED kept)
-- ---------------------------------------------------------------------------
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

-- ---------------------------------------------------------------------------
-- 2) Delivery columns: planned schedule + company receipt + reschedule lineage
-- ---------------------------------------------------------------------------
ALTER TABLE "Delivery"
  ADD COLUMN IF NOT EXISTS "plannedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rescheduleReason" TEXT,
  ADD COLUMN IF NOT EXISTS "supersedesDeliveryId" TEXT;

-- ---------------------------------------------------------------------------
-- 3) Same-PO reschedule lineage (blocks cross-order supersede links)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_id_purchaseOrderId_key"
  ON "Delivery"("id", "purchaseOrderId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_supersedesDeliveryId_fkey'
  ) THEN
    ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_supersedesDeliveryId_fkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_supersedes_same_po_fkey'
  ) THEN
    ALTER TABLE "Delivery"
      ADD CONSTRAINT "Delivery_supersedes_same_po_fkey"
      FOREIGN KEY ("supersedesDeliveryId", "purchaseOrderId")
      REFERENCES "Delivery"("id", "purchaseOrderId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_supersedes_not_self_check'
  ) THEN
    ALTER TABLE "Delivery"
      ADD CONSTRAINT "Delivery_supersedes_not_self_check"
      CHECK (
        "supersedesDeliveryId" IS NULL
        OR "supersedesDeliveryId" <> "id"
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Delivery_companyId_status_plannedDeliveryAt_idx"
  ON "Delivery"("companyId", "status", "plannedDeliveryAt");

CREATE INDEX IF NOT EXISTS "Delivery_supplierId_status_plannedDeliveryAt_idx"
  ON "Delivery"("supplierId", "status", "plannedDeliveryAt");

CREATE INDEX IF NOT EXISTS "Delivery_supersedesDeliveryId_idx"
  ON "Delivery"("supersedesDeliveryId");
