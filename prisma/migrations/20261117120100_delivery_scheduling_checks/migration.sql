-- Status-aware CHECKs for delivery scheduling (separate migration so enum
-- ADD VALUE from 20261117120000_delivery_scheduling is committed first).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_scheduled_requires_planned_date_check'
  ) THEN
    ALTER TABLE "Delivery"
      ADD CONSTRAINT "Delivery_scheduled_requires_planned_date_check"
      CHECK (
        status <> 'SCHEDULED'::"DeliveryStatus"
        OR "plannedDeliveryAt" IS NOT NULL
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_reschedule_requires_reason_check'
  ) THEN
    ALTER TABLE "Delivery"
      ADD CONSTRAINT "Delivery_reschedule_requires_reason_check"
      CHECK (
        "supersedesDeliveryId" IS NULL
        OR (
          "rescheduleReason" IS NOT NULL
          AND length(btrim("rescheduleReason")) > 0
        )
      );
  END IF;
END $$;
