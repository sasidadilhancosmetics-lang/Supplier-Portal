import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { lockCompanyCatalogue } from "@/lib/osf-imports/catalogue-lock";

import { writeCosmoIntegrationAudit } from "./audit";
import {
  assertCosmoCompanyBinding,
  authenticateIntegrationCredential,
  touchCredentialLastUsed,
  type AuthenticatedIntegrationCredential,
} from "./credentials";
import { CosmoIngestError } from "./errors";
import {
  deriveImportStatus,
  loadMappingLookups,
  mapInboundLines,
  type MappedLine,
} from "./mapping";
import {
  buildIngestSuccessResponse,
  type CosmoIngestSuccessResponse,
} from "./response";
import {
  assertContractHeaders,
  hashOsfPushPayload,
  parseCosmoOsfPushPayload,
  type CosmoOsfPushPayload,
} from "./schema";
import {
  loadSuggestionSupplierLookups,
  mapRequestSuggestions,
} from "./suggestion-mapping";
import { provisionOsfProducts } from "./provision-products";

async function loadSuccessFromImport(
  tx: Prisma.TransactionClient,
  args: { importId: string; companyId: string; replay: boolean },
): Promise<CosmoIngestSuccessResponse> {
  const osfImport = await tx.osfImport.findFirst({
    where: { id: args.importId, companyId: args.companyId },
    include: {
      lines: {
        select: {
          mappingStatus: true,
          quantityProposed: true,
          brandId: true,
          brandNameSnapshot: true,
        },
      },
      requirements: {
        include: {
          brand: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!osfImport) {
    throw new CosmoIngestError(
      "TEMPORARY_UNAVAILABLE",
      "Import disappeared after claim; retry.",
      { retryable: true },
    );
  }

  return buildIngestSuccessResponse({
    importId: osfImport.id,
    status: osfImport.status,
    idempotencyKey: osfImport.idempotencyKey,
    replay: args.replay,
    lines: osfImport.lines,
    requirements: osfImport.requirements.map((r) => ({
      id: r.id,
      brandId: r.brandId,
      brandName: r.brand.name,
      status: r.status,
      itemCount: r._count.items,
    })),
  });
}

async function createImportGraph(
  tx: Prisma.TransactionClient,
  args: {
    credential: AuthenticatedIntegrationCredential;
    payload: CosmoOsfPushPayload;
    payloadHash: string;
    mapped: MappedLine[];
    status: "NEEDS_REVIEW" | "READY_TO_CONFIRM";
  },
): Promise<string> {
  const importId = createId();
  const companyId = args.credential.companyId;

  await tx.osfImport.create({
    data: {
      id: importId,
      companyId,
      idempotencyKey: args.payload.idempotencyKey,
      payloadHash: args.payloadHash,
      contractVersion: args.payload.contractVersion,
      integrationCredentialId: args.credential.id,
      status: args.status,
      payload: args.payload as unknown as Prisma.InputJsonValue,
      processedAt: new Date(),
      externalId: args.payload.source.salesMonth ?? null,
    },
  });

  // One DRAFT requirement per resolved brand that has ≥1 MATCHED_SKU positive line.
  const matchedByBrand = new Map<string, MappedLine[]>();
  for (const line of args.mapped) {
    if (
      line.mappingStatus === "MATCHED_SKU" &&
      line.brandId &&
      line.productId &&
      line.quantityPlanned > 0
    ) {
      const list = matchedByBrand.get(line.brandId) ?? [];
      list.push(line);
      matchedByBrand.set(line.brandId, list);
    }
  }

  const requirementIdByBrand = new Map<string, string>();
  const itemIdByLineKey = new Map<string, string>();

  for (const [brandId, lines] of matchedByBrand) {
    const requirementId = createId();
    requirementIdByBrand.set(brandId, requirementId);

    const brandName =
      lines[0]?.brandNameSnapshot ?? brandId;
    await tx.requirement.create({
      data: {
        id: requirementId,
        companyId,
        brandId,
        osfImportId: importId,
        status: "DRAFT",
        title: `OSF import — ${brandName}`,
        items: {
          create: lines.map((line) => {
            const itemId = createId();
            itemIdByLineKey.set(line.lineKey, itemId);
            return {
              id: itemId,
              productId: line.productId!,
              quantityPlanned: new Prisma.Decimal(line.quantityPlanned),
              externalLineId: line.lineKey,
            };
          }),
        },
      },
    });

    await writeCosmoIntegrationAudit({
      tx,
      entityType: "Requirement",
      entityId: requirementId,
      action: "CREATE",
      credentialId: args.credential.id,
      afterJson: {
        event: "REQUIREMENT_DRAFT_CREATED",
        brandId,
        status: "DRAFT",
        osfImportId: importId,
        itemCount: lines.length,
        origin: "OSF_IMPORT",
      },
    });
  }

  const lineIdsByKey = new Map<string, string>();
  await tx.osfImportLine.createMany({
    data: args.mapped.map((line) => {
      const requirementId = line.brandId
        ? requirementIdByBrand.get(line.brandId) ?? null
        : null;
      const requirementItemId =
        line.mappingStatus === "MATCHED_SKU"
          ? itemIdByLineKey.get(line.lineKey) ?? null
          : null;
      // Linked items require product + requirement + qty > 0 (CHECK).
      const linked =
        requirementItemId != null &&
        line.productId != null &&
        requirementId != null &&
        line.quantityPlanned > 0;
      const lineId = createId();
      lineIdsByKey.set(line.lineKey, lineId);

      return {
        id: lineId,
        companyId,
        osfImportId: importId,
        sourceIndex: line.sourceIndex,
        lineKey: line.lineKey,
        sku: line.sku,
        descriptionSnapshot: line.descriptionSnapshot,
        cosmoVendorId: line.cosmoVendorId,
        brandNameSnapshot: line.brandNameSnapshot,
        erp1Priority: line.erp1Priority,
        erp2Priority: line.erp2Priority,
        quantityProposed: new Prisma.Decimal(line.quantityProposed),
        quantityPlanned: new Prisma.Decimal(line.quantityPlanned),
        mappingStatus: line.mappingStatus,
        brandId: line.brandId,
        productId: line.productId,
        requirementId: linked ? requirementId : null,
        requirementItemId: linked ? requirementItemId : null,
      };
    }),
  });

  const inboundSuggestions = args.payload.requestSuggestions ?? [];
  let suggestionCount = 0;
  if (inboundSuggestions.length > 0) {
    const suppliersByExternalId = await loadSuggestionSupplierLookups(tx, {
      companyId,
      cosmoSupplierIds: inboundSuggestions.map((s) => s.cosmoSupplierId),
    });
    const mappedSuggestions = mapRequestSuggestions({
      suggestions: inboundSuggestions,
      mappedLines: args.mapped,
      suppliersByExternalId,
    });

    await tx.osfRequestSuggestion.createMany({
      data: mappedSuggestions.map((suggestion) => {
        const osfImportLineId = lineIdsByKey.get(suggestion.lineKey);
        if (!osfImportLineId) {
          throw new CosmoIngestError(
            "TEMPORARY_UNAVAILABLE",
            "Suggestion line missing after import create; retry.",
            { retryable: true },
          );
        }
        return {
          id: createId(),
          companyId,
          osfImportId: importId,
          osfImportLineId,
          lineKey: suggestion.lineKey,
          cosmoSupplierId: suggestion.cosmoSupplierId,
          cosmoSupplierCode: suggestion.cosmoSupplierCode,
          cosmoSupplierName: suggestion.cosmoSupplierName,
          suggestedRequestQty: new Prisma.Decimal(
            suggestion.suggestedRequestQty,
          ),
          supplierId: suggestion.supplierId,
          mappingStatus: suggestion.mappingStatus,
          sourceSnapshot: suggestion.sourceSnapshot as Prisma.InputJsonValue,
          warningFlags: suggestion.warningFlags
            ? (suggestion.warningFlags as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        };
      }),
    });
    suggestionCount = mappedSuggestions.length;
  }

  await writeCosmoIntegrationAudit({
    tx,
    entityType: "OsfImport",
    entityId: importId,
    action: "CREATE",
    credentialId: args.credential.id,
    afterJson: {
      event: "OSF_IMPORT_RECEIVED",
      status: args.status,
      idempotencyKey: args.payload.idempotencyKey,
      payloadHash: args.payloadHash,
      lineCount: args.mapped.length,
      requirementCount: requirementIdByBrand.size,
      requestSuggestionCount: suggestionCount,
    },
  });

  return importId;
}

/**
 * Authenticate, validate, and atomically create OsfImport + lines + brand drafts.
 * companyId is always taken from the credential — never from the body.
 */
export async function ingestCosmoOsfRequirementImport(args: {
  authorizationHeader: string | null;
  contractVersionHeader: string | null;
  idempotencyKeyHeader: string | null;
  body: unknown;
  now?: Date;
}): Promise<{ status: 200 | 201; body: CosmoIngestSuccessResponse }> {
  const now = args.now ?? new Date();
  const credential = await authenticateIntegrationCredential({
    authorizationHeader: args.authorizationHeader,
    now,
  });

  const payload = parseCosmoOsfPushPayload(args.body);
  assertContractHeaders({
    contractVersionHeader: args.contractVersionHeader,
    idempotencyKeyHeader: args.idempotencyKeyHeader,
    payload,
  });
  assertCosmoCompanyBinding(credential, payload.source.cosmoCompanyId);

  const payloadHash = hashOsfPushPayload(payload);

  /**
   * Replay is read-only against business rows. Staff may have edited
   * quantityPlanned / mappingStatus / requirement items after ingest; we must
   * never recreate the graph or reset those fields. Only lastUsedAt on the
   * credential is touched.
   */
  async function replayExisting(importId: string) {
    await touchCredentialLastUsed({ credentialId: credential.id, now });
    const body = await loadSuccessFromImport(prisma, {
      importId,
      companyId: credential.companyId,
      replay: true,
    });
    return { status: 200 as const, body };
  }

  // Fast path outside a write txn (safe under unique (companyId, idempotencyKey)).
  const existing = await prisma.osfImport.findUnique({
    where: {
      companyId_idempotencyKey: {
        companyId: credential.companyId,
        idempotencyKey: payload.idempotencyKey,
      },
    },
    select: { id: true, payloadHash: true },
  });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new CosmoIngestError(
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key was already used with a different payload.",
      );
    }
    return replayExisting(existing.id);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Re-check inside the txn for a quieter race.
        const inside = await tx.osfImport.findUnique({
          where: {
            companyId_idempotencyKey: {
              companyId: credential.companyId,
              idempotencyKey: payload.idempotencyKey,
            },
          },
          select: { id: true, payloadHash: true },
        });
        if (inside) {
          if (inside.payloadHash !== payloadHash) {
            throw new CosmoIngestError(
              "IDEMPOTENCY_CONFLICT",
              "This idempotency key was already used with a different payload.",
            );
          }
          await touchCredentialLastUsed({
            credentialId: credential.id,
            now,
            tx,
          });
          const body = await loadSuccessFromImport(tx, {
            importId: inside.id,
            companyId: credential.companyId,
            replay: true,
          });
          return { httpStatus: 200 as const, body };
        }

        if (!await lockCompanyCatalogue(tx, credential.companyId, "receive-import")) {
          throw new CosmoIngestError("TEMPORARY_UNAVAILABLE", "Company unavailable for import.", { retryable: true });
        }
        const ambiguousBrands = await provisionOsfProducts(tx, credential.companyId, payload.items);
        const lookups = await loadMappingLookups(tx, {
          companyId: credential.companyId,
          items: payload.items,
        });
        for (const name of ambiguousBrands) lookups.brandsByName.delete(name);
        const mapped = mapInboundLines({
          items: payload.items,
          brandsByName: lookups.brandsByName,
          productsBySku: lookups.productsBySku,
        });
        const status = deriveImportStatus(mapped);
        const importId = await createImportGraph(tx, {
          credential,
          payload,
          payloadHash,
          mapped,
          status,
        });
        await touchCredentialLastUsed({
          credentialId: credential.id,
          now,
          tx,
        });
        const body = await loadSuccessFromImport(tx, {
          importId,
          companyId: credential.companyId,
          replay: false,
        });
        return { httpStatus: 201 as const, body };
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
    return { status: result.httpStatus, body: result.body };
  } catch (error) {
    // Postgres aborts the interactive transaction after a unique violation, so
    // concurrent losers must be handled outside the failed txn.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.osfImport.findUnique({
        where: {
          companyId_idempotencyKey: {
            companyId: credential.companyId,
            idempotencyKey: payload.idempotencyKey,
          },
        },
        select: { id: true, payloadHash: true },
      });
      if (!raced) {
        throw new CosmoIngestError(
          "TEMPORARY_UNAVAILABLE",
          "Concurrent ingest race; retry.",
          { retryable: true },
        );
      }
      if (raced.payloadHash !== payloadHash) {
        throw new CosmoIngestError(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used with a different payload.",
        );
      }
      return replayExisting(raced.id);
    }
    throw error;
  }
}
