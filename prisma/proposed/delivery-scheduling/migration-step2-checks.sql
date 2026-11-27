-- Optional step 2 (after enum ADD VALUE has committed): status-aware CHECKs.
-- Run in a SEPARATE transaction/session from migration.sql.
-- DO NOT APPLY without explicit approval.

-- SCHEDULED rows must have a planned date.
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

-- When claiming a reschedule link, require a reason on the NEW row.
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
