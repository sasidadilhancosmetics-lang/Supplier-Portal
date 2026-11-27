-- <<< GENERATED END

-- [custom] CHECK constraints. Prisma does not model CHECKs; names are listed in
-- docs/decisions.md and asserted by the post-apply verification.

ALTER TABLE "OsfImport"
  ADD CONSTRAINT "OsfImport_version_positive_chk" CHECK ("version" >= 1),
  -- Compared as text: 'CONFIRMED' was added to the enum in this transaction
  -- and cannot be used as an enum literal before COMMIT.
  ADD CONSTRAINT "OsfImport_confirmed_fields_chk" CHECK (
    "status"::text <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  );

ALTER TABLE "OsfImportLine"
  ADD CONSTRAINT "OsfImportLine_sourceIndex_nonneg_chk" CHECK ("sourceIndex" >= 0),
  ADD CONSTRAINT "OsfImportLine_quantityProposed_nonneg_chk" CHECK ("quantityProposed" >= 0),
  ADD CONSTRAINT "OsfImportLine_quantityPlanned_nonneg_chk" CHECK ("quantityPlanned" >= 0),
  ADD CONSTRAINT "OsfImportLine_version_positive_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "OsfImportLine_matched_requires_product_chk" CHECK (
    "mappingStatus" <> 'MATCHED_SKU' OR ("productId" IS NOT NULL AND "brandId" IS NOT NULL)
  ),
  ADD CONSTRAINT "OsfImportLine_item_link_chk" CHECK (
    "requirementItemId" IS NULL
    OR ("productId" IS NOT NULL AND "requirementId" IS NOT NULL AND "quantityPlanned" > 0)
  );

ALTER TABLE "OsfImportDistribution"
  ADD CONSTRAINT "OsfImportDistribution_attemptCount_nonneg_chk" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "OsfImportDistribution_version_positive_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "OsfImportDistribution_in_progress_claim_chk" CHECK (
    "status" <> 'IN_PROGRESS'
    OR ("claimToken" IS NOT NULL AND "claimedAt" IS NOT NULL AND "claimExpiresAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "OsfImportDistribution_terminal_no_claim_chk" CHECK (
    "status" = 'IN_PROGRESS' OR "claimToken" IS NULL
  ),
  -- CASE guards jsonb_array_length: AND operands have no guaranteed evaluation order.
  ADD CONSTRAINT "OsfImportDistribution_succeeded_fields_chk" CHECK (
    "status" <> 'SUCCEEDED'
    OR ("completedAt" IS NOT NULL
        AND CASE WHEN jsonb_typeof("supplierRequestIds") = 'array'
                 THEN jsonb_array_length("supplierRequestIds") > 0
                 ELSE false END)
  ),
  ADD CONSTRAINT "OsfImportDistribution_skipped_fields_chk" CHECK (
    "status" <> 'SKIPPED_ALREADY_REQUESTED'
    OR ("completedAt" IS NOT NULL
        AND CASE WHEN jsonb_typeof("alreadyRequestedSupplierIds") = 'array'
                 THEN jsonb_array_length("alreadyRequestedSupplierIds") > 0
                 ELSE false END
        AND ("supplierRequestIds" IS NULL OR "supplierRequestIds" = '[]'::jsonb))
  ),
  ADD CONSTRAINT "OsfImportDistribution_failed_fields_chk" CHECK (
    "status" <> 'FAILED' OR "lastError" IS NOT NULL
  );

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_revoked_inactive_chk" CHECK ("revokedAt" IS NULL OR "isActive" = false);

COMMIT;
