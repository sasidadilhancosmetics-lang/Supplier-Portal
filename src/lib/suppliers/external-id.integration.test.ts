/**
 * Neon development F2B Cosmo externalId mapping tests.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 * Refuses the production Neon branch id.
 */
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireStaffPermission: vi.fn(),
  canStaffPermission: vi.fn(),
}));

config({ path: ".env.local" });

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";

const run =
  process.env.RUN_DB_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  process.env.NEON_BRANCH_ID !== PRODUCTION_BRANCH_ID;

describe.runIf(run)("supplier Cosmo externalId mapping (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let updateSupplierExternalId: typeof import("./mutations").updateSupplierExternalId;
  let requireAdmin: typeof import("@/lib/auth/guards").requireAdmin;

  const tag = `f2b_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    companyOther: `${tag}_co2`,
    brandA: `${tag}_br_a`,
    brandB: `${tag}_br_b`,
    productA: `${tag}_pr_a`,
    supplierA: `${tag}_sup_a`,
    supplierB: `${tag}_sup_b`,
    supplierOther: `${tag}_sup_o`,
    adminUser: `${tag}_admin`,
    importId: `${tag}_imp`,
    lineMatched: `${tag}_line_m`,
    lineZero: `${tag}_line_z`,
    suggestionUnresolved: `${tag}_sug_u`,
    suggestionZero: `${tag}_sug_z`,
    cred: `${tag}_cred`,
  };
  const cosmoId = `${tag}_cosmo_sup`;
  const cosmoIdOther = `${tag}_cosmo_other`;

  function adminUser(companyId: string) {
    return {
      id: ids.adminUser,
      companyId,
      role: "ADMIN" as const,
      email: `${tag}@example.com`,
      name: "Admin",
      supplierId: null as string | null,
      isActive: true,
    };
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ updateSupplierExternalId } = await import("./mutations"));
    ({ requireAdmin } = await import("@/lib/auth/guards"));

    await prisma.company.createMany({
      data: [
        { id: ids.company, name: `Co ${tag}` },
        { id: ids.companyOther, name: `Other ${tag}` },
      ],
    });
    await prisma.user.create({
      data: {
        id: ids.adminUser,
        companyId: ids.company,
        role: "ADMIN",
        email: `${tag}@example.com`,
        name: "Admin",
      },
    });
    await prisma.brand.createMany({
      data: [
        { id: ids.brandA, companyId: ids.company, name: `Brand A ${tag}` },
        { id: ids.brandB, companyId: ids.company, name: `Brand B ${tag}` },
      ],
    });
    await prisma.product.create({
      data: {
        id: ids.productA,
        companyId: ids.company,
        brandId: ids.brandA,
        name: "Product A",
        sku: `SKU-A-${tag}`,
        isActive: true,
      },
    });
    await prisma.supplier.createMany({
      data: [
        {
          id: ids.supplierA,
          companyId: ids.company,
          name: `Supplier A ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
        },
        {
          id: ids.supplierB,
          companyId: ids.company,
          name: `Supplier B ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: false,
        },
        {
          id: ids.supplierOther,
          companyId: ids.companyOther,
          name: `Supplier Other ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
        },
      ],
    });
    await prisma.supplierBrand.create({
      data: { supplierId: ids.supplierB, brandId: ids.brandB },
    });

    await prisma.integrationCredential.create({
      data: {
        id: ids.cred,
        companyId: ids.company,
        cosmoCompanyId: `cosmo-${tag}`,
        name: "cred",
        tokenHash: randomBytes(32).toString("hex"),
        tokenPrefix: "tok_",
        isActive: true,
      },
    });

    await prisma.osfImport.create({
      data: {
        id: ids.importId,
        companyId: ids.company,
        idempotencyKey: `idem-${tag}`,
        payloadHash: "a".repeat(64),
        contractVersion: "cosmo-osf-push.v1",
        status: "NEEDS_REVIEW",
        payload: { f2b: true },
        integrationCredentialId: ids.cred,
      },
    });
    await prisma.osfImportLine.createMany({
      data: [
        {
          id: ids.lineMatched,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 0,
          lineKey: "SKU-A",
          sku: "SKU-A",
          descriptionSnapshot: "A",
          brandNameSnapshot: `Brand A ${tag}`,
          quantityProposed: 10,
          quantityPlanned: 10,
          mappingStatus: "MATCHED_SKU",
          brandId: ids.brandA,
          productId: ids.productA,
        },
        {
          id: ids.lineZero,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 1,
          lineKey: "SKU-Z",
          sku: "SKU-Z",
          descriptionSnapshot: "Z",
          brandNameSnapshot: `Brand A ${tag}`,
          quantityProposed: 0,
          quantityPlanned: 0,
          mappingStatus: "REJECTED_ZERO_QTY",
          brandId: ids.brandA,
        },
      ],
    });
    await prisma.osfRequestSuggestion.createMany({
      data: [
        {
          id: ids.suggestionUnresolved,
          companyId: ids.company,
          osfImportId: ids.importId,
          osfImportLineId: ids.lineMatched,
          lineKey: "SKU-A",
          cosmoSupplierId: cosmoId,
          cosmoSupplierName: "Cosmo Unresolved",
          suggestedRequestQty: 4,
          supplierId: null,
          mappingStatus: "UNRESOLVED_SUPPLIER",
          sourceSnapshot: {
            lineKey: "SKU-A",
            cosmoSupplierId: cosmoId,
            cosmoSupplierName: "Cosmo Unresolved",
            suggestedRequestQty: 4,
          },
        },
        {
          id: ids.suggestionZero,
          companyId: ids.company,
          osfImportId: ids.importId,
          osfImportLineId: ids.lineZero,
          lineKey: "SKU-Z",
          cosmoSupplierId: cosmoId,
          cosmoSupplierName: "Cosmo Unresolved",
          suggestedRequestQty: 2,
          supplierId: null,
          mappingStatus: "LINE_NOT_ACTIONABLE",
          sourceSnapshot: {
            lineKey: "SKU-Z",
            cosmoSupplierId: cosmoId,
            cosmoSupplierName: "Cosmo Unresolved",
            suggestedRequestQty: 2,
          },
        },
      ],
    });
  }, 60_000);

  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue(
      adminUser(ids.company) as never,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.osfRequestSuggestion.deleteMany({
      where: { osfImportId: ids.importId },
    });
    await prisma.osfImportLine.deleteMany({
      where: { osfImportId: ids.importId },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          {
            entityType: "Supplier",
            entityId: { in: [ids.supplierA, ids.supplierB, ids.supplierOther] },
          },
          { entityType: "OsfImport", entityId: ids.importId },
        ],
      },
    });
    await prisma.osfImport.deleteMany({ where: { id: ids.importId } });
    await prisma.integrationCredential.deleteMany({ where: { id: ids.cred } });
    await prisma.supplierBrand.deleteMany({
      where: {
        supplierId: { in: [ids.supplierA, ids.supplierB, ids.supplierOther] },
      },
    });
    await prisma.supplier.deleteMany({
      where: { id: { in: [ids.supplierA, ids.supplierB, ids.supplierOther] } },
    });
    await prisma.product.deleteMany({ where: { id: ids.productA } });
    await prisma.brand.deleteMany({
      where: { id: { in: [ids.brandA, ids.brandB] } },
    });
    await prisma.user.deleteMany({ where: { id: ids.adminUser } });
    await prisma.company.deleteMany({
      where: { id: { in: [ids.company, ids.companyOther] } },
    });
    await prisma.$disconnect();
  }, 60_000);

  it("sets mapping, rematches unresolved→MATCHED and zero→LINE_NOT_ACTIONABLE", async () => {
    const protectedBefore = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { id: true, status: true, version: true },
    });
    const requestCountBefore = await prisma.supplierRequest.count({
      where: { companyId: ids.company },
    });

    const result = await updateSupplierExternalId({
      supplierId: ids.supplierA,
      externalId: cosmoId,
      expectedExternalId: null,
    });
    expect(result.externalId).toBe(cosmoId);
    expect(result.remapped).toBeGreaterThanOrEqual(1);

    const matched = await prisma.osfRequestSuggestion.findUniqueOrThrow({
      where: { id: ids.suggestionUnresolved },
    });
    expect(matched.mappingStatus).toBe("MATCHED_SUPPLIER");
    expect(matched.supplierId).toBe(ids.supplierA);
    expect(matched.suggestedRequestQty.toString()).toBe("4");
    expect(matched.sourceSnapshot).toMatchObject({
      cosmoSupplierId: cosmoId,
      suggestedRequestQty: 4,
    });

    const zero = await prisma.osfRequestSuggestion.findUniqueOrThrow({
      where: { id: ids.suggestionZero },
    });
    expect(zero.mappingStatus).toBe("LINE_NOT_ACTIONABLE");
    expect(zero.supplierId).toBe(ids.supplierA);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "Supplier",
        entityId: ids.supplierA,
        action: "EXTERNAL_ID_CHANGE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.beforeJson).toMatchObject({ externalId: null });
    expect(audit?.afterJson).toMatchObject({ externalId: cosmoId });

    expect(
      await prisma.supplierRequest.count({ where: { companyId: ids.company } }),
    ).toBe(requestCountBefore);
    expect(
      await prisma.purchaseOrder.findMany({
        where: { orderNumber: "PO-20261112-E5D42983" },
        select: { id: true, status: true, version: true },
      }),
    ).toEqual(protectedBefore);
  }, 60_000);

  it("rejects duplicate Cosmo id in company but allows other company", async () => {
    await expect(
      updateSupplierExternalId({
        supplierId: ids.supplierB,
        externalId: cosmoId,
        expectedExternalId: null,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_EXTERNAL_ID" });

    vi.mocked(requireAdmin).mockResolvedValueOnce(
      adminUser(ids.companyOther) as never,
    );
    const allowed = await updateSupplierExternalId({
      supplierId: ids.supplierOther,
      externalId: cosmoId,
      expectedExternalId: null,
    });
    expect(allowed.externalId).toBe(cosmoId);
  }, 60_000);

  it("rematches to INELIGIBLE_BRAND when mapped supplier lacks brand", async () => {
    await updateSupplierExternalId({
      supplierId: ids.supplierA,
      externalId: "",
      confirmChange: true,
      expectedExternalId: cosmoId,
    });
    await updateSupplierExternalId({
      supplierId: ids.supplierB,
      externalId: cosmoId,
      expectedExternalId: null,
    });

    const row = await prisma.osfRequestSuggestion.findUniqueOrThrow({
      where: { id: ids.suggestionUnresolved },
    });
    expect(row.mappingStatus).toBe("INELIGIBLE_BRAND");
    expect(row.supplierId).toBe(ids.supplierB);
    expect(row.suggestedRequestQty.toString()).toBe("4");
  }, 60_000);

  it("requires confirmation to change mapping and handles concurrent expected mismatch", async () => {
    await expect(
      updateSupplierExternalId({
        supplierId: ids.supplierB,
        externalId: cosmoIdOther,
        confirmChange: false,
        expectedExternalId: cosmoId,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    await expect(
      updateSupplierExternalId({
        supplierId: ids.supplierB,
        externalId: cosmoIdOther,
        confirmChange: true,
        expectedExternalId: "stale-value",
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_ID_CONFLICT" });

    const changed = await updateSupplierExternalId({
      supplierId: ids.supplierB,
      externalId: cosmoIdOther,
      confirmChange: true,
      expectedExternalId: cosmoId,
    });
    expect(changed.externalId).toBe(cosmoIdOther);

    const row = await prisma.osfRequestSuggestion.findUniqueOrThrow({
      where: { id: ids.suggestionUnresolved },
    });
    expect(row.mappingStatus).toBe("UNRESOLVED_SUPPLIER");
    expect(row.supplierId).toBeNull();
  }, 60_000);

  it("clears mapping with confirmation", async () => {
    await updateSupplierExternalId({
      supplierId: ids.supplierB,
      externalId: cosmoId,
      confirmChange: true,
      expectedExternalId: cosmoIdOther,
    });
    const cleared = await updateSupplierExternalId({
      supplierId: ids.supplierB,
      externalId: "",
      confirmChange: true,
      expectedExternalId: cosmoId,
    });
    expect(cleared.externalId).toBeNull();
    const row = await prisma.osfRequestSuggestion.findUniqueOrThrow({
      where: { id: ids.suggestionUnresolved },
    });
    expect(row.mappingStatus).toBe("UNRESOLVED_SUPPLIER");
  }, 60_000);
});
