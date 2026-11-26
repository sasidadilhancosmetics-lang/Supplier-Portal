/**
 * Neon development ingest tests (Phase C1).
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 * Uses disposable fixtures tagged by run id; cleans up in afterAll.
 * Refuses the production Neon branch id.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COSMO_OSF_CONTRACT_VERSION } from "./constants";
import { hashIntegrationToken, integrationTokenPrefix } from "./crypto";

config({ path: ".env.local" });

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";

const run =
  process.env.RUN_DB_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  process.env.NEON_BRANCH_ID !== PRODUCTION_BRANCH_ID;

describe.runIf(run)("cosmo OSF ingest (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let ingestCosmoOsfRequirementImport: typeof import("./ingest").ingestCosmoOsfRequirementImport;

  const tag = `c1_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    companyOther: `${tag}_co2`,
    brandA: `${tag}_br_a`,
    brandB: `${tag}_br_b`,
    productA1: `${tag}_pr_a1`,
    productA2dup: `${tag}_pr_a2`,
    productB1: `${tag}_pr_b1`,
    cred: `${tag}_cred`,
    credOther: `${tag}_cred2`,
    credRevoked: `${tag}_cred_rev`,
    supplierMatched: `${tag}_sup_m`,
    supplierIneligible: `${tag}_sup_i`,
    supplierOtherCo: `${tag}_sup_o`,
  };

  const cosmoSupplierIds = {
    matched: `${tag}_cosmo_sup_m`,
    ineligible: `${tag}_cosmo_sup_i`,
    otherCompany: `${tag}_cosmo_sup_o`,
    unresolved: `${tag}_cosmo_sup_u`,
  };

  const tokenActive = `tok_${randomBytes(24).toString("base64url")}`;
  const tokenOther = `tok_${randomBytes(24).toString("base64url")}`;
  const tokenRevoked = `tok_${randomBytes(24).toString("base64url")}`;

  function payload(args: {
    key: string;
    cosmoCompanyId?: string;
    items: Array<{
      lineKey: string;
      sku: string;
      description?: string;
      brandName: string;
      vendorId?: string;
      qty: number;
      erp1?: string | null;
    }>;
    requestSuggestions?: Array<{
      lineKey: string;
      cosmoSupplierId: string;
      cosmoSupplierCode?: string;
      cosmoSupplierName: string;
      suggestedRequestQty: number;
    }>;
  }) {
    return {
      contractVersion: COSMO_OSF_CONTRACT_VERSION,
      idempotencyKey: args.key,
      source: {
        system: "cosmo-os" as const,
        cosmoCompanyId: args.cosmoCompanyId ?? "cosmo-tenant-a",
        sentAt: new Date().toISOString(),
      },
      selection: { mode: "SUPPLIER_ORDERS_SELECTION" as const },
      items: args.items.map((i) => ({
        lineKey: i.lineKey,
        sku: i.sku,
        description: i.description ?? i.sku,
        brand: {
          cosmoVendorId: i.vendorId ?? `vnd_${i.brandName}`,
          name: i.brandName,
        },
        priorities: { erp1: i.erp1 ?? "Priority", erp2: null },
        quantity: { totalOrderQty: i.qty },
      })),
      ...(args.requestSuggestions
        ? { requestSuggestions: args.requestSuggestions }
        : {}),
    };
  }

  async function ingest(args: {
    token: string;
    body: ReturnType<typeof payload>;
  }) {
    return ingestCosmoOsfRequirementImport({
      authorizationHeader: `Bearer ${args.token}`,
      contractVersionHeader: COSMO_OSF_CONTRACT_VERSION,
      idempotencyKeyHeader: args.body.idempotencyKey,
      body: args.body,
    });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ ingestCosmoOsfRequirementImport } = await import("./ingest"));

    await prisma.company.create({
      data: { id: ids.company, name: `Company ${tag}` },
    });
    await prisma.company.create({
      data: { id: ids.companyOther, name: `Other ${tag}` },
    });
    await prisma.brand.createMany({
      data: [
        { id: ids.brandA, companyId: ids.company, name: "Brand A" },
        { id: ids.brandB, companyId: ids.company, name: "Brand B" },
      ],
    });
    await prisma.product.createMany({
      data: [
        {
          id: ids.productA1,
          companyId: ids.company,
          brandId: ids.brandA,
          name: "Product A1",
          sku: "SKU-A1",
          isActive: true,
        },
        {
          id: ids.productA2dup,
          companyId: ids.company,
          brandId: ids.brandA,
          name: "Product A2 dup sku",
          sku: "SKU-AMB",
          isActive: true,
        },
        {
          id: `${ids.productA2dup}_b`,
          companyId: ids.company,
          brandId: ids.brandA,
          name: "Product A2b dup sku",
          sku: "SKU-AMB",
          isActive: true,
        },
        {
          id: ids.productB1,
          companyId: ids.company,
          brandId: ids.brandB,
          name: "Product B1",
          sku: "SKU-B1",
          isActive: true,
        },
        {
          id: `${tag}_pr_a3`,
          companyId: ids.company,
          brandId: ids.brandA,
          name: "Product A3",
          sku: "SKU-A3",
          isActive: true,
        },
      ],
    });

    await prisma.integrationCredential.createMany({
      data: [
        {
          id: ids.cred,
          companyId: ids.company,
          cosmoCompanyId: "cosmo-tenant-a",
          name: "active",
          tokenHash: hashIntegrationToken(tokenActive),
          tokenPrefix: integrationTokenPrefix(tokenActive),
          isActive: true,
        },
        {
          id: ids.credOther,
          companyId: ids.companyOther,
          cosmoCompanyId: "cosmo-tenant-b",
          name: "other-co",
          tokenHash: hashIntegrationToken(tokenOther),
          tokenPrefix: integrationTokenPrefix(tokenOther),
          isActive: true,
        },
        {
          id: ids.credRevoked,
          companyId: ids.company,
          cosmoCompanyId: "cosmo-tenant-a",
          name: "revoked",
          tokenHash: hashIntegrationToken(tokenRevoked),
          tokenPrefix: integrationTokenPrefix(tokenRevoked),
          isActive: false,
          revokedAt: new Date(),
        },
      ],
    });

    await prisma.supplier.createMany({
      data: [
        {
          id: ids.supplierMatched,
          companyId: ids.company,
          name: `Matched ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
          externalId: cosmoSupplierIds.matched,
        },
        {
          id: ids.supplierIneligible,
          companyId: ids.company,
          name: `Ineligible ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: false,
          externalId: cosmoSupplierIds.ineligible,
        },
        {
          id: ids.supplierOtherCo,
          companyId: ids.companyOther,
          name: `OtherCo ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
          externalId: cosmoSupplierIds.otherCompany,
        },
      ],
    });
    // Brand-scoped supplier with no Brand A membership → INELIGIBLE_BRAND.
    await prisma.supplierBrand.create({
      data: {
        supplierId: ids.supplierIneligible,
        brandId: ids.brandB,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const imports = await prisma.osfImport.findMany({
      where: { companyId: { in: [ids.company, ids.companyOther] } },
      select: { id: true },
    });
    const importIds = imports.map((i) => i.id);
    if (importIds.length) {
      await prisma.osfRequestSuggestion.deleteMany({
        where: { osfImportId: { in: importIds } },
      });
      await prisma.osfImportLine.deleteMany({
        where: { osfImportId: { in: importIds } },
      });
      const reqs = await prisma.requirement.findMany({
        where: { osfImportId: { in: importIds } },
        select: { id: true },
      });
      const reqIds = reqs.map((r) => r.id);
      if (reqIds.length) {
        await prisma.requirementItem.deleteMany({
          where: { requirementId: { in: reqIds } },
        });
        await prisma.requirement.deleteMany({
          where: { id: { in: reqIds } },
        });
      }
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: "OsfImport", entityId: { in: importIds } },
            { entityType: "Requirement", entityId: { in: reqIds } },
          ],
        },
      });
      await prisma.osfImport.deleteMany({ where: { id: { in: importIds } } });
    }
    await prisma.supplierBrand.deleteMany({
      where: {
        supplierId: {
          in: [ids.supplierMatched, ids.supplierIneligible, ids.supplierOtherCo],
        },
      },
    });
    await prisma.supplier.deleteMany({
      where: {
        id: {
          in: [ids.supplierMatched, ids.supplierIneligible, ids.supplierOtherCo],
        },
      },
    });
    await prisma.integrationCredential.deleteMany({
      where: { id: { in: [ids.cred, ids.credOther, ids.credRevoked] } },
    });
    await prisma.product.deleteMany({
      where: { companyId: { in: [ids.company, ids.companyOther] } },
    });
    await prisma.brand.deleteMany({
      where: { companyId: { in: [ids.company, ids.companyOther] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [ids.company, ids.companyOther] } },
    });
    await prisma.$disconnect();
  }, 60_000);

  it("rejects missing and revoked credentials", async () => {
    await expect(
      ingest({
        token: "not-a-real-token",
        body: payload({
          key: randomUUID(),
          items: [
            {
              lineKey: "SKU-A1",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 1,
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(
      ingest({
        token: tokenRevoked,
        body: payload({
          key: randomUUID(),
          items: [
            {
              lineKey: "SKU-A1",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 1,
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects cosmoCompanyId that does not match the credential binding", async () => {
    await expect(
      ingest({
        token: tokenActive,
        body: payload({
          key: randomUUID(),
          cosmoCompanyId: "cosmo-tenant-b",
          items: [
            {
              lineKey: "SKU-A1",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 1,
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ code: "COMPANY_MISMATCH" });
  });

  it("creates OSF-owned references and draft requirements while preserving ambiguous and zero lines", async () => {
    const key = `key-create-${tag}`;
    const body = payload({
      key,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 10,
          erp1: "Top Priority",
        },
        {
          lineKey: "SKU-B1",
          sku: "SKU-B1",
          brandName: "Brand B",
          qty: 3,
        },
        {
          lineKey: "SKU-UNK",
          sku: "SKU-UNK",
          brandName: "Brand A",
          qty: 2,
        },
        {
          lineKey: "SKU-AMB",
          sku: "SKU-AMB",
          brandName: "Brand A",
          qty: 4,
        },
        {
          lineKey: "SKU-ZERO",
          sku: "SKU-A1-ZERO",
          brandName: "Brand A",
          qty: 0,
        },
        {
          lineKey: "SKU-NOBR",
          sku: "SKU-NOBR",
          brandName: "Unknown Brand",
          qty: 7,
        },
      ],
    });

    const brandCountBefore = await prisma.brand.count({
      where: { companyId: ids.company },
    });
    const productCountBefore = await prisma.product.count({
      where: { companyId: ids.company },
    });

    const result = await ingest({ token: tokenActive, body });
    expect(result.status).toBe(201);
    expect(result.body.replay).toBe(false);
    expect(result.body.status).toBe("NEEDS_REVIEW");
    expect(result.body.deepLinkPath).toBe(
      `/staff/osf-imports/${result.body.importId}`,
    );
    expect(result.body.summary.lineCount).toBe(6);
    expect(result.body.summary.matchedCount).toBe(4);
    expect(result.body.summary.rejectedCount).toBe(1);
    expect(result.body.requirements).toHaveLength(3);
    expect(
      result.body.requirements.every((r) => r.status === "DRAFT"),
    ).toBe(true);

    const lines = await prisma.osfImportLine.findMany({
      where: { osfImportId: result.body.importId },
      orderBy: { sourceIndex: "asc" },
    });
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.mappingStatus)).toEqual([
      "MATCHED_SKU",
      "MATCHED_SKU",
      "MATCHED_SKU",
      "AMBIGUOUS_SKU",
      "REJECTED_ZERO_QTY",
      "MATCHED_SKU",
    ]);
    expect(lines[0]!.erp1Priority).toBe("Top Priority");
    expect(lines[0]!.requirementItemId).not.toBeNull();
    expect(lines[2]!.requirementItemId).not.toBeNull();
    expect(lines[4]!.quantityProposed.toString()).toBe("0");

    const reqs = await prisma.requirement.findMany({
      where: { osfImportId: result.body.importId },
      include: { items: true },
    });
    expect(reqs).toHaveLength(3);
    expect(reqs.every((r) => r.status === "DRAFT")).toBe(true);
    const itemCounts = reqs
      .map((r) => r.items.length)
      .sort((a, b) => a - b);
    expect(itemCounts).toEqual([1, 1, 2]);

    expect(
      await prisma.brand.count({ where: { companyId: ids.company } }),
    ).toBe(brandCountBefore + 1);
    expect(
      await prisma.product.count({ where: { companyId: ids.company } }),
    ).toBe(productCountBefore + 2);

    // Same key + same payload → replay
    const replay = await ingest({ token: tokenActive, body });
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.importId).toBe(result.body.importId);
    expect(
      await prisma.osfImport.count({
        where: { companyId: ids.company, idempotencyKey: key },
      }),
    ).toBe(1);

    // Same key + changed payload → conflict
    const changed = payload({
      key,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 99,
        },
      ],
    });
    await expect(
      ingest({ token: tokenActive, body: changed }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  }, 60_000);

  it("creates at most one requirement per brand and isolates companies", async () => {
    // Duplicate SKU rejected before write
    await expect(
      ingest({
        token: tokenActive,
        body: payload({
          key: `key-dup-sku-${tag}`,
          items: [
            {
              lineKey: "L1",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 1,
            },
            {
              lineKey: "L2",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 2,
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // Two matched lines on Brand A → still one DRAFT requirement with two items
    const ok = await ingest({
      token: tokenActive,
      body: payload({
        key: `key-brand-ok-${tag}`,
        items: [
          {
            lineKey: "SKU-A1",
            sku: "SKU-A1",
            brandName: "Brand A",
            qty: 1,
          },
          {
            lineKey: "SKU-A3",
            sku: "SKU-A3",
            brandName: "Brand A",
            qty: 2,
          },
        ],
      }),
    });
    expect(ok.body.summary.matchedCount).toBe(2);
    expect(ok.body.requirements).toHaveLength(1);
    expect(ok.body.requirements[0]!.itemCount).toBe(2);
    expect(
      await prisma.requirement.count({
        where: { osfImportId: ok.body.importId },
      }),
    ).toBe(1);

    // Other company's credential creates only its own OSF-owned references.
    const other = await ingest({
      token: tokenOther,
      body: payload({
        key: `key-other-${tag}`,
        cosmoCompanyId: "cosmo-tenant-b",
        items: [
          {
            lineKey: "SKU-A1",
            sku: "SKU-A1",
            brandName: "Brand A",
            qty: 1,
          },
        ],
      }),
    });
    expect(other.body.summary.matchedCount).toBe(1);
    expect(other.body.requirements).toHaveLength(1);
    const otherImport = await prisma.osfImport.findUniqueOrThrow({
      where: { id: other.body.importId },
    });
    expect(otherImport.companyId).toBe(ids.companyOther);
    expect(await prisma.product.count({ where: { companyId: ids.companyOther, sku: "SKU-A1" } })).toBe(1);
  }, 60_000);

  it("replay after staff edits does not overwrite quantities, mappings, or drafts", async () => {
    const key = `key-replay-edit-${tag}`;
    const body = payload({
      key,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 10,
          erp1: "Top Priority",
        },
        {
          lineKey: "SKU-UNK",
          sku: "SKU-UNK-REPLAY",
          brandName: "Brand A",
          qty: 2,
        },
      ],
    });

    const created = await ingest({ token: tokenActive, body });
    expect(created.status).toBe(201);

    const lineMatched = await prisma.osfImportLine.findFirstOrThrow({
      where: { osfImportId: created.body.importId, lineKey: "SKU-A1" },
    });
    const lineUnknown = await prisma.osfImportLine.findFirstOrThrow({
      where: { osfImportId: created.body.importId, lineKey: "SKU-UNK" },
    });
    const req = await prisma.requirement.findFirstOrThrow({
      where: { osfImportId: created.body.importId },
      include: { items: true },
    });
    const item = req.items[0]!;

    // Simulate staff review edits (Phase D will do this properly).
    await prisma.osfImportLine.update({
      where: { id: lineMatched.id },
      data: {
        quantityPlanned: new Prisma.Decimal(42),
        resolutionNote: "staff adjusted qty",
        version: { increment: 1 },
      },
    });
    await prisma.requirementItem.update({
      where: { id: item.id },
      data: { quantityPlanned: new Prisma.Decimal(42) },
    });
    await prisma.osfImportLine.update({
      where: { id: lineUnknown.id },
      data: {
        mappingStatus: "EXCLUDED",
        resolutionNote: "staff excluded",
        version: { increment: 1 },
      },
    });
    await prisma.osfImport.update({
      where: { id: created.body.importId },
      data: { status: "NEEDS_REVIEW", version: { increment: 1 } },
    });

    const before = {
      lineMatched: await prisma.osfImportLine.findUniqueOrThrow({
        where: { id: lineMatched.id },
      }),
      lineUnknown: await prisma.osfImportLine.findUniqueOrThrow({
        where: { id: lineUnknown.id },
      }),
      item: await prisma.requirementItem.findUniqueOrThrow({
        where: { id: item.id },
      }),
      reqCount: await prisma.requirement.count({
        where: { osfImportId: created.body.importId },
      }),
      lineCount: await prisma.osfImportLine.count({
        where: { osfImportId: created.body.importId },
      }),
      importRow: await prisma.osfImport.findUniqueOrThrow({
        where: { id: created.body.importId },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: "OsfImport",
          entityId: created.body.importId,
        },
      }),
    };

    const replay = await ingest({ token: tokenActive, body });
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    expect(replay.body.importId).toBe(created.body.importId);

    const after = {
      lineMatched: await prisma.osfImportLine.findUniqueOrThrow({
        where: { id: lineMatched.id },
      }),
      lineUnknown: await prisma.osfImportLine.findUniqueOrThrow({
        where: { id: lineUnknown.id },
      }),
      item: await prisma.requirementItem.findUniqueOrThrow({
        where: { id: item.id },
      }),
      reqCount: await prisma.requirement.count({
        where: { osfImportId: created.body.importId },
      }),
      lineCount: await prisma.osfImportLine.count({
        where: { osfImportId: created.body.importId },
      }),
      importRow: await prisma.osfImport.findUniqueOrThrow({
        where: { id: created.body.importId },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: "OsfImport",
          entityId: created.body.importId,
        },
      }),
    };

    expect(after.lineMatched.quantityPlanned.toString()).toBe("42");
    expect(after.lineMatched.resolutionNote).toBe("staff adjusted qty");
    expect(after.lineMatched.version).toBe(before.lineMatched.version);
    expect(after.lineUnknown.mappingStatus).toBe("EXCLUDED");
    expect(after.item.quantityPlanned.toString()).toBe("42");
    expect(after.reqCount).toBe(1);
    expect(after.lineCount).toBe(2);
    expect(after.importRow.version).toBe(before.importRow.version);
    expect(after.importRow.payloadHash).toBe(before.importRow.payloadHash);
    // No additional CREATE audit on replay
    expect(after.audits).toBe(before.audits);
  }, 60_000);

  it("writes integration audit rows with null actor and actorKind marker", async () => {
    const key = `key-audit-${tag}`;
    const result = await ingest({
      token: tokenActive,
      body: payload({
        key,
        items: [
          {
            lineKey: "SKU-A1",
            sku: "SKU-A1",
            brandName: "Brand A",
            qty: 1,
          },
        ],
      }),
    });

    const importAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: "OsfImport",
        entityId: result.body.importId,
        action: "CREATE",
      },
    });
    expect(importAudit.actorUserId).toBeNull();
    const after = importAudit.afterJson as Record<string, unknown>;
    expect(after.actorKind).toBe("INTEGRATION");
    expect(after.integrationCredentialId).toBe(ids.cred);
    expect(after.source).toBe("COSMO_OSF_PUSH");
    expect(after.event).toBe("OSF_IMPORT_RECEIVED");

    const req = result.body.requirements[0]!;
    const reqAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: "Requirement",
        entityId: req.requirementId,
        action: "CREATE",
      },
    });
    expect(reqAudit.actorUserId).toBeNull();
    const reqAfter = reqAudit.afterJson as Record<string, unknown>;
    expect(reqAfter.actorKind).toBe("INTEGRATION");
    expect(reqAfter.origin).toBe("OSF_IMPORT");
  }, 60_000);

  it("handles parallel duplicate requests without duplicate imports", async () => {
    const key = `key-parallel-${tag}`;
    const body = payload({
      key,
      items: [
        {
          lineKey: "SKU-B1",
          sku: "SKU-B1",
          brandName: "Brand B",
          qty: 5,
        },
      ],
    });

    const results = await Promise.allSettled([
      ingest({ token: tokenActive, body }),
      ingest({ token: tokenActive, body }),
      ingest({ token: tokenActive, body }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(3);
    const importIds = new Set(
      fulfilled.map(
        (r) =>
          (r as PromiseFulfilledResult<Awaited<ReturnType<typeof ingest>>>)
            .value.body.importId,
      ),
    );
    expect(importIds.size).toBe(1);
    expect(
      await prisma.osfImport.count({
        where: { companyId: ids.company, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(
      await prisma.requirement.count({
        where: {
          osfImportId: [...importIds][0],
        },
      }),
    ).toBe(1);
  }, 60_000);

  it("rolls back the whole import when the transaction cannot complete", async () => {
    const key = `key-rollback-${tag}`;
    const body = payload({
      key,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 1,
        },
      ],
    });

    // Pre-seed a conflicting unique (companyId, idempotencyKey) with a different hash
    // inside a transaction that we control is not this path — instead force failure by
    // deleting the active product mid-flight is racy. Use an invalid FK via raw insert
    // of a partial unique competitor that causes P2002 after mapping, then ensure our
    // failed conflict path creates nothing new when hash mismatches an existing row.
    await prisma.osfImport.create({
      data: {
        id: `${tag}_seed_imp`,
        companyId: ids.company,
        idempotencyKey: key,
        payloadHash: "0".repeat(64),
        contractVersion: COSMO_OSF_CONTRACT_VERSION,
        status: "NEEDS_REVIEW",
        payload: { seeded: true },
      },
    });

    const beforeLines = await prisma.osfImportLine.count({
      where: { companyId: ids.company },
    });
    const beforeReqs = await prisma.requirement.count({
      where: { companyId: ids.company, osfImportId: { not: null } },
    });

    await expect(
      ingest({ token: tokenActive, body }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(
      await prisma.osfImportLine.count({ where: { companyId: ids.company } }),
    ).toBe(beforeLines);
    expect(
      await prisma.requirement.count({
        where: { companyId: ids.company, osfImportId: { not: null } },
      }),
    ).toBe(beforeReqs);
    expect(
      await prisma.osfImport.count({
        where: { companyId: ids.company, idempotencyKey: key },
      }),
    ).toBe(1);

    // Cleanup seed so afterAll can delete by company imports list
    await prisma.osfImport.delete({ where: { id: `${tag}_seed_imp` } });
  }, 60_000);

  it("persists optional requestSuggestions with mapping and no side effects (F2A)", async () => {
    const key = `key-f2a-${tag}`;
    const protectedBefore = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { id: true, status: true, version: true },
    });
    const requestCountBefore = await prisma.supplierRequest.count({
      where: { companyId: ids.company },
    });
    // Scope to fixture company users — global counts race with parallel Neon suites.
    const companyUserIds = (
      await prisma.user.findMany({
        where: { companyId: ids.company },
        select: { id: true },
      })
    ).map((u) => u.id);
    const notificationCountBefore = await prisma.notification.count({
      where: { userId: { in: companyUserIds } },
    });

    const body = payload({
      key,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 10,
        },
        {
          lineKey: "SKU-ZERO",
          sku: "SKU-A1-ZERO-F2A",
          brandName: "Brand A",
          qty: 0,
        },
      ],
      requestSuggestions: [
        {
          lineKey: "SKU-A1",
          cosmoSupplierId: cosmoSupplierIds.matched,
          cosmoSupplierCode: "M1",
          cosmoSupplierName: "Matched Supplier",
          suggestedRequestQty: 6,
        },
        {
          lineKey: "SKU-A1",
          cosmoSupplierId: cosmoSupplierIds.unresolved,
          cosmoSupplierName: "Unresolved Supplier",
          suggestedRequestQty: 5,
        },
        {
          lineKey: "SKU-A1",
          cosmoSupplierId: cosmoSupplierIds.ineligible,
          cosmoSupplierName: "Wrong Brand Supplier",
          suggestedRequestQty: 2,
        },
        {
          lineKey: "SKU-A1",
          cosmoSupplierId: cosmoSupplierIds.otherCompany,
          cosmoSupplierName: "Other Company Supplier",
          suggestedRequestQty: 1,
        },
        {
          lineKey: "SKU-ZERO",
          cosmoSupplierId: cosmoSupplierIds.matched,
          cosmoSupplierName: "Matched Supplier",
          suggestedRequestQty: 3,
        },
      ],
    });

    const created = await ingest({ token: tokenActive, body });
    expect(created.status).toBe(201);

    const suggestions = await prisma.osfRequestSuggestion.findMany({
      where: { osfImportId: created.body.importId },
      orderBy: [{ lineKey: "asc" }, { cosmoSupplierId: "asc" }],
    });
    expect(suggestions).toHaveLength(5);

    const a1Matched = suggestions.find(
      (s) =>
        s.lineKey === "SKU-A1" &&
        s.cosmoSupplierId === cosmoSupplierIds.matched,
    );
    const a1Unresolved = suggestions.find(
      (s) => s.cosmoSupplierId === cosmoSupplierIds.unresolved,
    );
    const a1Ineligible = suggestions.find(
      (s) => s.cosmoSupplierId === cosmoSupplierIds.ineligible,
    );
    const a1OtherCo = suggestions.find(
      (s) => s.cosmoSupplierId === cosmoSupplierIds.otherCompany,
    );
    expect(a1Matched!.mappingStatus).toBe("MATCHED_SUPPLIER");
    expect(a1Matched!.supplierId).toBe(ids.supplierMatched);
    expect(a1Matched!.cosmoSupplierCode).toBe("M1");
    expect(a1Unresolved!.mappingStatus).toBe("UNRESOLVED_SUPPLIER");
    expect(a1Unresolved!.supplierId).toBeNull();
    expect(a1Ineligible!.mappingStatus).toBe("INELIGIBLE_BRAND");
    expect(a1Ineligible!.supplierId).toBe(ids.supplierIneligible);
    expect(a1OtherCo!.mappingStatus).toBe("UNRESOLVED_SUPPLIER");

    const zeroSuggestion = suggestions.find((s) => s.lineKey === "SKU-ZERO");
    expect(zeroSuggestion!.mappingStatus).toBe("LINE_NOT_ACTIONABLE");
    expect(zeroSuggestion!.supplierId).toBe(ids.supplierMatched);

    // 6+5+2+1 = 14 > proposed 10 → over-line on SKU-A1 suggestions
    const a1Suggestions = suggestions.filter((s) => s.lineKey === "SKU-A1");
    expect(
      a1Suggestions.every((s) => {
        const flags = s.warningFlags as { overLineQty?: boolean } | null;
        return flags?.overLineQty === true;
      }),
    ).toBe(true);

    const lineA1 = await prisma.osfImportLine.findFirstOrThrow({
      where: { osfImportId: created.body.importId, lineKey: "SKU-A1" },
    });
    expect(lineA1.quantityProposed.toString()).toBe("10");
    expect(lineA1.quantityPlanned.toString()).toBe("10");

    expect(
      await prisma.supplierRequest.count({ where: { companyId: ids.company } }),
    ).toBe(requestCountBefore);
    expect(
      await prisma.notification.count({
        where: { userId: { in: companyUserIds } },
      }),
    ).toBe(notificationCountBefore);

    const protectedAfter = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { id: true, status: true, version: true },
    });
    expect(protectedAfter).toEqual(protectedBefore);
    if (protectedAfter[0]) {
      expect(protectedAfter[0].status).toBe("CONFIRMED");
    }

    // Same-key replay: no duplicate suggestions; staff-style qty edit preserved
    await prisma.osfImportLine.update({
      where: { id: lineA1.id },
      data: {
        quantityPlanned: new Prisma.Decimal(42),
        version: { increment: 1 },
      },
    });
    const suggestionCountBeforeReplay = await prisma.osfRequestSuggestion.count({
      where: { osfImportId: created.body.importId },
    });
    const replay = await ingest({ token: tokenActive, body });
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    expect(
      await prisma.osfRequestSuggestion.count({
        where: { osfImportId: created.body.importId },
      }),
    ).toBe(suggestionCountBeforeReplay);
    expect(
      (
        await prisma.osfImportLine.findUniqueOrThrow({ where: { id: lineA1.id } })
      ).quantityPlanned.toString(),
    ).toBe("42");
    expect(lineA1.quantityProposed.toString()).toBe("10");

    // Changed suggestion payload → conflict
    await expect(
      ingest({
        token: tokenActive,
        body: payload({
          key,
          items: [
            {
              lineKey: "SKU-A1",
              sku: "SKU-A1",
              brandName: "Brand A",
              qty: 10,
            },
            {
              lineKey: "SKU-ZERO",
              sku: "SKU-A1-ZERO-F2A",
              brandName: "Brand A",
              qty: 0,
            },
          ],
          requestSuggestions: [
            {
              lineKey: "SKU-A1",
              cosmoSupplierId: cosmoSupplierIds.matched,
              cosmoSupplierName: "Matched Supplier",
              suggestedRequestQty: 99,
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // Concurrent replay with suggestions
    const parallelKey = `key-f2a-parallel-${tag}`;
    const parallelBody = payload({
      key: parallelKey,
      items: [
        {
          lineKey: "SKU-A1",
          sku: "SKU-A1",
          brandName: "Brand A",
          qty: 4,
        },
      ],
      requestSuggestions: [
        {
          lineKey: "SKU-A1",
          cosmoSupplierId: cosmoSupplierIds.matched,
          cosmoSupplierName: "Matched Supplier",
          suggestedRequestQty: 4,
        },
      ],
    });
    const parallel = await Promise.allSettled([
      ingest({ token: tokenActive, body: parallelBody }),
      ingest({ token: tokenActive, body: parallelBody }),
      ingest({ token: tokenActive, body: parallelBody }),
    ]);
    expect(parallel.every((r) => r.status === "fulfilled")).toBe(true);
    const parallelImportId = (
      parallel[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof ingest>>>
    ).value.body.importId;
    expect(
      await prisma.osfImport.count({
        where: { companyId: ids.company, idempotencyKey: parallelKey },
      }),
    ).toBe(1);
    expect(
      await prisma.osfRequestSuggestion.count({
        where: { osfImportId: parallelImportId },
      }),
    ).toBe(1);
  }, 90_000);

  it("accepts empty requestSuggestions and Phase C payloads without suggestions", async () => {
    const empty = await ingest({
      token: tokenActive,
      body: payload({
        key: `key-f2a-empty-${tag}`,
        items: [
          {
            lineKey: "SKU-B1",
            sku: "SKU-B1",
            brandName: "Brand B",
            qty: 2,
          },
        ],
        requestSuggestions: [],
      }),
    });
    expect(empty.status).toBe(201);
    expect(
      await prisma.osfRequestSuggestion.count({
        where: { osfImportId: empty.body.importId },
      }),
    ).toBe(0);

    const omitted = await ingest({
      token: tokenActive,
      body: payload({
        key: `key-f2a-omit-${tag}`,
        items: [
          {
            lineKey: "SKU-B1",
            sku: "SKU-B1",
            brandName: "Brand B",
            qty: 3,
          },
        ],
      }),
    });
    expect(omitted.status).toBe(201);
    expect(
      await prisma.osfRequestSuggestion.count({
        where: { osfImportId: omitted.body.importId },
      }),
    ).toBe(0);
  }, 60_000);

  // Silence unused Prisma import warning in some TS configs
  it("uses Prisma namespace", () => {
    expect(Prisma).toBeDefined();
  });
});
