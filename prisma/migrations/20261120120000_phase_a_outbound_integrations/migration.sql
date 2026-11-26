-- Proposal only. Keep outside prisma/migrations until explicitly approved.
BEGIN;

CREATE TYPE "OutboundIntegrationProvider" AS ENUM ('ERP_NEXT', 'SHOPIFY');

CREATE TABLE "OutboundIntegrationConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "OutboundIntegrationProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialCiphertext" BYTEA,
    "credentialNonce" BYTEA,
    "credentialTag" BYTEA,
    "credentialKeyId" TEXT,
    "credentialRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundIntegrationConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboundIntegrationConnection_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "OutboundIntegrationConnection_label_chk"
        CHECK ("label" = btrim("label") AND char_length("label") BETWEEN 1 AND 100),
    CONSTRAINT "OutboundIntegrationConnection_origin_chk"
        CHECK (
            char_length("origin") <= 261
            AND "origin" ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
            AND ("provider" <> 'SHOPIFY' OR
                 "origin" ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.]myshopify[.]com$')
        ),
    CONSTRAINT "OutboundIntegrationConnection_version_chk"
        CHECK ("configVersion" > 0),
    CONSTRAINT "OutboundIntegrationConnection_bundle_chk"
        CHECK (
            num_nonnulls(
                "credentialCiphertext", "credentialNonce", "credentialTag",
                "credentialKeyId", "credentialRotatedAt"
            ) IN (0, 5)
        ),
    CONSTRAINT "OutboundIntegrationConnection_credential_shape_chk"
        CHECK (
            "credentialCiphertext" IS NULL OR (
                octet_length("credentialCiphertext") > 0
                AND octet_length("credentialNonce") = 12
                AND octet_length("credentialTag") = 16
                AND btrim("credentialKeyId") <> ''
            )
        ),
    CONSTRAINT "OutboundIntegrationConnection_enabled_credential_chk"
        CHECK (NOT "enabled" OR "credentialCiphertext" IS NOT NULL)
);

CREATE UNIQUE INDEX "OutboundIntegrationConnection_companyId_provider_origin_key"
    ON "OutboundIntegrationConnection" ("companyId", "provider", "origin");

CREATE UNIQUE INDEX "OutboundIntegrationConnection_one_enabled_shopify_key"
    ON "OutboundIntegrationConnection" ("companyId")
    WHERE "provider" = 'SHOPIFY' AND "enabled";

-- The credential authentication context includes these four identity fields.
CREATE FUNCTION "rejectOutboundIntegrationIdentityChange"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
       OR NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."origin" IS DISTINCT FROM OLD."origin" THEN
        RAISE EXCEPTION 'Outbound integration identity is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'OutboundIntegrationConnection_identity_immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "OutboundIntegrationConnection_identity_immutable"
    BEFORE UPDATE ON "OutboundIntegrationConnection"
    FOR EACH ROW
    EXECUTE FUNCTION "rejectOutboundIntegrationIdentityChange"();

COMMIT;
