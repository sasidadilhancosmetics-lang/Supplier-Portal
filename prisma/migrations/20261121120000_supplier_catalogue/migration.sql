-- Additive catalogue only. The existing PriceAgreement foreign keys are untouched.
CREATE UNIQUE INDEX "Product_id_companyId_key" ON "Product" ("id", "companyId");
CREATE INDEX "OsfImport_catalogue_latest_idx" ON "OsfImport" ("companyId", "status", "confirmedAt" DESC, "id" DESC);

CREATE TABLE "SupplierCatalogueSkuExclusion" (
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("companyId", "supplierId", "productId"),
    FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("productId", "companyId") REFERENCES "Product"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierCataloguePriceRevision" (
    "id" TEXT PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL CHECK ("revision" > 0),
    "unitPrice" DECIMAL(18,2) NOT NULL CHECK ("unitPrice" > 0 AND "unitPrice" <> 'NaN'::numeric),
    "currencyCode" TEXT NOT NULL DEFAULT 'LKR' CHECK ("currencyCode" = 'LKR'),
    "unitOfMeasure" TEXT,
    "moq" DECIMAL(18,4) CHECK ("moq" > 0 AND "moq" <> 'NaN'::numeric),
    "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
    FOREIGN KEY ("supplierId", "companyId") REFERENCES "Supplier"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY ("productId", "companyId") REFERENCES "Product"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "CataloguePriceRevision_stream_key" UNIQUE ("companyId", "supplierId", "productId", "revision"),
    CONSTRAINT "CataloguePriceRevision_idempotency_key" UNIQUE ("companyId", "supplierId", "productId", "idempotencyKey")
);

CREATE FUNCTION "reject_catalogue_price_revision_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Catalogue price revisions are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "CataloguePriceRevision_immutable" BEFORE UPDATE OR DELETE
    ON "SupplierCataloguePriceRevision" FOR EACH ROW
    EXECUTE FUNCTION "reject_catalogue_price_revision_mutation"();

CREATE TYPE "CatalogueMediaStatus" AS ENUM ('UNMAPPED', 'APPROVED', 'NEEDS_REVIEW', 'UNAVAILABLE');

CREATE TABLE "ProductCatalogueMedia" (
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceCompanyId" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "storeHostname" TEXT NOT NULL,
    "cosmoProductItemId" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "mappedSku" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "status" "CatalogueMediaStatus" NOT NULL DEFAULT 'UNMAPPED',
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSuccessfulRefreshAt" TIMESTAMP(3),
    "refreshVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("refreshVersion" > 0),
    "refreshFailedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    PRIMARY KEY ("companyId", "productId"),
    UNIQUE ("productId", "companyId"),
    FOREIGN KEY ("productId", "companyId") REFERENCES "Product"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" <> 'APPROVED' OR (
        "cosmoProductItemId" IS NOT NULL AND "shopifyProductId" IS NOT NULL
        AND "shopifyVariantId" IS NOT NULL AND "imageUrl" IS NOT NULL
    ))
);

CREATE UNIQUE INDEX "ProductCatalogueMedia_approved_variant_key"
    ON "ProductCatalogueMedia" ("companyId", "sourceCompanyId", "sourceLocationId", "storeHostname", "shopifyVariantId")
    WHERE "status" = 'APPROVED';
