-- Proposed migration: price comparison & negotiation
-- DO NOT APPLY without explicit approval.
-- Neon development only. Does not modify existing PurchaseOrder / OrderItem values.
-- Candidate name: 20261113180000_price_negotiation

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "PriceNegotiationChannel" AS ENUM ('PORTAL', 'PHONE', 'WHATSAPP');

CREATE TYPE "PriceQuoteKind" AS ENUM (
  'SUPPLIER_ORIGINAL',
  'SUPPLIER_REVISED',
  'COMPANY_COUNTER',
  'STAFF_RECORDED_EXTERNAL',
  'SUPPLIER_ACCEPTANCE'
);

CREATE TYPE "PriceAgreementStatus" AS ENUM (
  'QUOTED',
  'COUNTER_PENDING',
  'STAFF_RECORDED_UNCONFIRMED',
  'SUPPLIER_CONFIRMED',
  'STAFF_ATTESTED_AGREED',
  'DECLINED',
  'SUPERSEDED'
);

-- ---------------------------------------------------------------------------
-- Append-only price quote history
-- ---------------------------------------------------------------------------
CREATE TABLE "PriceQuote" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "availabilityOfferId" TEXT,
  "requestItemId" TEXT,
  "supplierRequestId" TEXT,
  "channel" "PriceNegotiationChannel" NOT NULL,
  "kind" "PriceQuoteKind" NOT NULL,
  "status" "PriceAgreementStatus" NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "currencyCode" TEXT,
  "quantityContext" DECIMAL(18,4),
  "availableDate" TIMESTAMP(3),
  "notes" TEXT,
  "negotiationOccurredAt" TIMESTAMP(3),
  "attestationStatement" TEXT,
  "evidenceNote" TEXT,
  "attestedAt" TIMESTAMP(3),
  "attestedByUserId" TEXT,
  "recordedByUserId" TEXT,
  "supersedesQuoteId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceQuote_unitPrice_positive" CHECK ("unitPrice" > 0)
);

CREATE INDEX "PriceQuote_companyId_productId_createdAt_idx"
  ON "PriceQuote" ("companyId", "productId", "createdAt");
CREATE INDEX "PriceQuote_companyId_supplierId_productId_createdAt_idx"
  ON "PriceQuote" ("companyId", "supplierId", "productId", "createdAt");
CREATE INDEX "PriceQuote_availabilityOfferId_createdAt_idx"
  ON "PriceQuote" ("availabilityOfferId", "createdAt");
CREATE INDEX "PriceQuote_supplierRequestId_idx"
  ON "PriceQuote" ("supplierRequestId");
CREATE INDEX "PriceQuote_requestItemId_idx"
  ON "PriceQuote" ("requestItemId");
CREATE INDEX "PriceQuote_supersedesQuoteId_idx"
  ON "PriceQuote" ("supersedesQuoteId");

-- Enables PriceAgreement composite FK (currentQuoteId, availabilityOfferId)
-- so the current quote must belong to the same offer (rehearsed additive improvement).
CREATE UNIQUE INDEX "PriceQuote_id_availabilityOfferId_key"
  ON "PriceQuote" ("id", "availabilityOfferId");

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_supplier_company_fkey"
  FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_availabilityOffer_fkey"
  FOREIGN KEY ("availabilityOfferId", "supplierId")
  REFERENCES "AvailabilityOffer"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_requestItem_fkey"
  FOREIGN KEY ("requestItemId", "supplierId")
  REFERENCES "RequestItem"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_supplierRequest_fkey"
  FOREIGN KEY ("supplierRequestId", "supplierId", "companyId")
  REFERENCES "SupplierRequest"("id", "supplierId", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_recordedByUserId_fkey"
  FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_attestedByUserId_fkey"
  FOREIGN KEY ("attestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_supersedesQuoteId_fkey"
  FOREIGN KEY ("supersedesQuoteId") REFERENCES "PriceQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Current agreement pointer (mutable status / currentQuoteId / version only)
-- ---------------------------------------------------------------------------
CREATE TABLE "PriceAgreement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "availabilityOfferId" TEXT NOT NULL,
  "requestItemId" TEXT,
  "status" "PriceAgreementStatus" NOT NULL,
  "currentQuoteId" TEXT NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "currencyCode" TEXT,
  "channel" "PriceNegotiationChannel" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceAgreement_unitPrice_positive" CHECK ("unitPrice" > 0),
  CONSTRAINT "PriceAgreement_availabilityOfferId_key" UNIQUE ("availabilityOfferId")
);

CREATE INDEX "PriceAgreement_companyId_productId_status_idx"
  ON "PriceAgreement" ("companyId", "productId", "status");
CREATE INDEX "PriceAgreement_supplierId_status_idx"
  ON "PriceAgreement" ("supplierId", "status");
CREATE INDEX "PriceAgreement_currentQuoteId_idx"
  ON "PriceAgreement" ("currentQuoteId");

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_supplier_company_fkey"
  FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_availabilityOffer_fkey"
  FOREIGN KEY ("availabilityOfferId", "supplierId")
  REFERENCES "AvailabilityOffer"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_requestItem_fkey"
  FOREIGN KEY ("requestItemId", "supplierId")
  REFERENCES "RequestItem"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceAgreement"
  ADD CONSTRAINT "PriceAgreement_currentQuote_offer_fkey"
  FOREIGN KEY ("currentQuoteId", "availabilityOfferId")
  REFERENCES "PriceQuote"("id", "availabilityOfferId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- OrderItem: bind allocated line to explicit quote + status snapshot
-- Existing unitPrice values and confirmed POs are left unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderItem"
  ADD COLUMN "priceQuoteId" TEXT,
  ADD COLUMN "priceAgreementStatusAtOrder" "PriceAgreementStatus";

CREATE INDEX "OrderItem_priceQuoteId_idx" ON "OrderItem" ("priceQuoteId");

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_priceQuoteId_fkey"
  FOREIGN KEY ("priceQuoteId") REFERENCES "PriceQuote"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
