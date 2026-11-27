-- Rollback for proposed price-negotiation migration.
-- Development only. Does not modify PurchaseOrder rows or AvailabilityOffer.unitPrice.
-- Safe only if no production reliance on PriceQuote / PriceAgreement / new OrderItem columns.

BEGIN;

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_priceQuoteId_fkey";
DROP INDEX IF EXISTS "OrderItem_priceQuoteId_idx";
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "priceAgreementStatusAtOrder";
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "priceQuoteId";

DROP TABLE IF EXISTS "PriceAgreement";
DROP TABLE IF EXISTS "PriceQuote";

DROP TYPE IF EXISTS "PriceAgreementStatus";
DROP TYPE IF EXISTS "PriceQuoteKind";
DROP TYPE IF EXISTS "PriceNegotiationChannel";

COMMIT;
