-- Proposed migration: delivery scheduling & company receipt
-- DO NOT APPLY without explicit approval.
-- Neon development only. Does not UPDATE/DELETE existing Delivery or Grn rows.
-- Candidate name: 20261117120000_delivery_scheduling
--
-- NOTE: ALTER TYPE ... ADD VALUE must commit before CHECKs that reference the new
-- labels. Apply as two steps (or two migration files) if the runner wraps everything
-- in one transaction that also uses the new labels. This file only ADDS labels and
-- does not INSERT/CHECK against SCHEDULED/SUPERSEDED in the same transaction.

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
-- Composite FK: (supersedesDeliveryId, purchaseOrderId) → Delivery(id, purchaseOrderId)
-- MATCH SIMPLE: when supersedesDeliveryId IS NULL, FK is not enforced.
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

-- Block self-supersede (circular single-node). Longer cycles are app-enforced.
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
