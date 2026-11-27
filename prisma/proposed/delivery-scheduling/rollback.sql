-- Rollback for proposed delivery-scheduling migration (development / rehearsal only).
-- DO NOT RUN against production.
-- WARNING: PostgreSQL cannot easily DROP enum values. Labels SCHEDULED / SUPERSEDED
-- remain on DeliveryStatus after this script. Safe only if no rows use those statuses
-- (or after deleting/rewriting such rows — not done here).

BEGIN;

ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_scheduled_requires_planned_date_check";
ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_reschedule_requires_reason_check";
ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_supersedes_not_self_check";
ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_supersedes_same_po_fkey";
ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_supersedesDeliveryId_fkey";

DROP INDEX IF EXISTS "Delivery_supersedesDeliveryId_idx";
DROP INDEX IF EXISTS "Delivery_supplierId_status_plannedDeliveryAt_idx";
DROP INDEX IF EXISTS "Delivery_companyId_status_plannedDeliveryAt_idx";
DROP INDEX IF EXISTS "Delivery_id_purchaseOrderId_key";

ALTER TABLE "Delivery"
  DROP COLUMN IF EXISTS "supersedesDeliveryId",
  DROP COLUMN IF EXISTS "rescheduleReason",
  DROP COLUMN IF EXISTS "receivedAt",
  DROP COLUMN IF EXISTS "plannedDeliveryAt";

COMMIT;

-- Enum labels SCHEDULED / SUPERSEDED are left in place intentionally.
