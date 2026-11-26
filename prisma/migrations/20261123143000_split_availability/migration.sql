ALTER TABLE "AvailabilityOffer" ADD COLUMN "availableSplits" JSONB;
ALTER TABLE "AvailabilityOffer" ADD CONSTRAINT "AvailabilityOffer_availableSplits_array"
  CHECK (CASE WHEN "availableSplits" IS NULL THEN TRUE
              WHEN jsonb_typeof("availableSplits") = 'array'
                THEN jsonb_array_length("availableSplits") BETWEEN 1 AND 20
              ELSE FALSE END);

ALTER TABLE "PurchaseOrder" ADD COLUMN "requiresScheduleApproval" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Delivery" ADD COLUMN "scheduleApprovedAt" TIMESTAMP(3);
