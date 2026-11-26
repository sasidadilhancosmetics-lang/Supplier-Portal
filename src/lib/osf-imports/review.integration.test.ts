/**
 * Neon development Import Review mutation tests (Phase D1).
 * Skips unless RUN_DB_INTEGRATION=1. Disposable fixtures cleaned in afterAll.
 */
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: ".env.local" });

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";
const run =
  process.env.RUN_DB_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  process.env.NEON_BRANCH_ID !== PRODUCTION_BRANCH_ID;

vi.mock("@/lib/auth/guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/guards")>(
    "@/lib/auth/guards",
  );
  return {
    ...actual,
    requireStaffPermission: vi.fn(),
  };
});

describe.runIf(run)("osf import review mutations (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let requireStaffPermission: ReturnType<typeof vi.fn>;
  let updateImportLineQuantity: typeof import("./mutations").updateImportLineQuantity;
  let linkImportLineToProduct: typeof import("./mutations").linkImportLineToProduct;
  let excludeImportLine: typeof import("./mutations").excludeImportLine;
  let restoreImportLine: typeof import("./mutations").restoreImportLine;
  let resolveImportLineBrand: typeof import("./mutations").resolveImportLineBrand;
  let getOsfImportReview: typeof import("./queries").getOsfImportReview;

  const tag = `d1_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    otherCompany: `${tag}_co2`,
    brand: `${tag}_br`,
    brandOther: `${tag}_br2`,
    product: `${tag}_pr`,
    product2: `${tag}_pr2`,
    staff: `${tag}_st`,
    importId: `${tag}_imp`,
    lineMatched: `${tag}_lm`,
    lineUnknown: `${tag}_lu`,
    lineUnknownBrand: `${tag}_lub`,
    lineZero: `${tag}_lz`,
    req: `${tag}_rq`,
    item: `${tag}_ri`,
  };

  const staffUser = {
    id: ids.staff,
    email: `${tag}@example.com`,
    name: "Staff",
    role: "STAFF" as const,
    companyId: ids.company,
    supplierId: null,
    isActive: true,
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ requireStaffPermission } = await import("@/lib/auth/guards") as never);
    ({
      updateImportLineQuantity,
      linkImportLineToProduct,
      excludeImportLine,
      restoreImportLine,
      resolveImportLineBrand,
    } = await import("./mutations"));
    ({ getOsfImportReview } = await import("./queries"));

    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);

    await prisma.company.create({
      data: { id: ids.company, name: `Co ${tag}` },
    });
    await prisma.company.create({
      data: { id: ids.otherCompany, name: `Other ${tag}` },
    });
    await prisma.user.create({
      data: {
        id: ids.staff,
        companyId: ids.company,
        email: staffUser.email,
        role: "STAFF",
        isActive: true,
      },
    });
    await prisma.brand.createMany({
      data: [
        { id: ids.brand, companyId: ids.company, name: "Brand D1" },
        { id: ids.brandOther, companyId: ids.company, name: "Brand D1 B" },
      ],
    });
    await prisma.product.createMany({
      data: [
        {
          id: ids.product,
          companyId: ids.company,
          brandId: ids.brand,
          name: "Prod 1",
          sku: "D1-SKU-1",
          isActive: true,
        },
        {
          id: ids.product2,
          companyId: ids.company,
          brandId: ids.brand,
          name: "Prod 2",
          sku: "D1-SKU-2",
          isActive: true,
        },
      ],
    });

    await prisma.osfImport.create({
      data: {
        id: ids.importId,
        companyId: ids.company,
        idempotencyKey: `d1-key-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        contractVersion: "cosmo-osf-push.v1",
        status: "NEEDS_REVIEW",
        payload: { test: true },
        version: 1,
      },
    });
    await prisma.requirement.create({
      data: {
        id: ids.req,
        companyId: ids.company,
        brandId: ids.brand,
        osfImportId: ids.importId,
        status: "DRAFT",
        title: "OSF import — Brand D1",
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: ids.item,
        requirementId: ids.req,
        productId: ids.product,
        quantityPlanned: 10,
        externalLineId: "D1-SKU-1",
      },
    });
    await prisma.osfImportLine.createMany({
      data: [
        {
          id: ids.lineMatched,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 0,
          lineKey: "D1-SKU-1",
          sku: "D1-SKU-1",
          descriptionSnapshot: "Prod 1",
          cosmoVendorId: "vnd_d1",
          brandNameSnapshot: "Brand D1",
          quantityProposed: 10,
          quantityPlanned: 10,
          mappingStatus: "MATCHED_SKU",
          brandId: ids.brand,
          productId: ids.product,
          requirementId: ids.req,
          requirementItemId: ids.item,
          version: 1,
        },
        {
          id: ids.lineUnknown,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 1,
          lineKey: "D1-UNK",
          sku: "D1-UNK",
          descriptionSnapshot: "Unknown",
          cosmoVendorId: "vnd_d1",
          brandNameSnapshot: "Brand D1",
          quantityProposed: 4,
          quantityPlanned: 4,
          mappingStatus: "UNKNOWN_SKU",
          brandId: ids.brand,
          version: 1,
        },
        {
          id: ids.lineUnknownBrand,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 2,
          lineKey: "D1-NOBR",
          sku: "D1-NOBR",
          descriptionSnapshot: "No brand",
          cosmoVendorId: "vnd_new",
          brandNameSnapshot: "Mystery Brand",
          quantityProposed: 2,
          quantityPlanned: 2,
          mappingStatus: "UNKNOWN_BRAND",
          version: 1,
        },
        {
          id: ids.lineZero,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 3,
          lineKey: "D1-ZERO",
          sku: "D1-ZERO",
          descriptionSnapshot: "Zero",
          cosmoVendorId: "vnd_d1",
          brandNameSnapshot: "Brand D1",
          quantityProposed: 0,
          quantityPlanned: 0,
          mappingStatus: "REJECTED_ZERO_QTY",
          brandId: ids.brand,
          version: 1,
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.osfImportLine.deleteMany({
      where: { osfImportId: ids.importId },
    });
    await prisma.requirementItem.deleteMany({
      where: { requirementId: ids.req },
    });
    // any extra requirements created during resolve
    const reqs = await prisma.requirement.findMany({
      where: { osfImportId: ids.importId },
      select: { id: true },
    });
    await prisma.requirementItem.deleteMany({
      where: { requirementId: { in: reqs.map((r) => r.id) } },
    });
    await prisma.requirement.deleteMany({
      where: { osfImportId: ids.importId },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "OsfImport", entityId: ids.importId },
          { actorUserId: ids.staff },
        ],
      },
    });
    await prisma.osfImport.deleteMany({ where: { id: ids.importId } });
    await prisma.product.deleteMany({
      where: { companyId: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.brand.deleteMany({
      where: { companyId: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.user.deleteMany({ where: { id: ids.staff } });
    await prisma.company.deleteMany({
      where: { id: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.$disconnect();
  }, 60_000);

  it("keeps zero-qty lines visible in the review model", async () => {
    // getOsfImportReview uses requireRequirementReadAccess — mock via guards path
    // requireRequirementReadAccess calls requireStaffPermission; our mock returns staffUser.
    const { requireRequirementReadAccess } = await import(
      "@/lib/requirements/access"
    );
    // Patch by ensuring requireStaffPermission works for MANAGE etc.
    const review = await getOsfImportReview(ids.importId);
    expect(review.summary.lineCount).toBe(4);
    expect(review.brands.some((b) => b.lines.some((l) => l.id === ids.lineZero))).toBe(
      true,
    );
    void requireRequirementReadAccess;
  });

  it("updates quantity and syncs RequirementItem with version checks", async () => {
    const before = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    const lineBefore = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineMatched },
    });

    await updateImportLineQuantity({
      importId: ids.importId,
      lineId: ids.lineMatched,
      lineVersion: lineBefore.version,
      importVersion: before.version,
      quantityPlanned: 15,
    });

    const line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineMatched },
    });
    const item = await prisma.requirementItem.findUniqueOrThrow({
      where: { id: ids.item },
    });
    expect(line.quantityPlanned.toString()).toBe("15");
    expect(item.quantityPlanned.toString()).toBe("15");
    expect(line.quantityProposed.toString()).toBe("10");

    await expect(
      updateImportLineQuantity({
        importId: ids.importId,
        lineId: ids.lineMatched,
        lineVersion: lineBefore.version,
        importVersion: before.version,
        quantityPlanned: 99,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("links an unknown SKU to a product and recalculates status", async () => {
    const imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    const line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknown },
    });

    await linkImportLineToProduct({
      importId: ids.importId,
      lineId: ids.lineUnknown,
      lineVersion: line.version,
      importVersion: imp.version,
      productId: ids.product2,
    });

    const updated = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknown },
    });
    expect(updated.mappingStatus).toBe("MATCHED_SKU");
    expect(updated.requirementItemId).not.toBeNull();
    expect(updated.productId).toBe(ids.product2);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "OsfImport",
        entityId: ids.importId,
        actorUserId: ids.staff,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("excludes and restores a line without deleting the OsfImportLine row", async () => {
    let imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    let line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknown },
    });

    await excludeImportLine({
      importId: ids.importId,
      lineId: ids.lineUnknown,
      lineVersion: line.version,
      importVersion: imp.version,
      reason: "Not needed this cycle",
    });

    line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknown },
    });
    expect(line.mappingStatus).toBe("EXCLUDED");
    expect(line.requirementItemId).toBeNull();
    expect(await prisma.osfImportLine.count({ where: { id: ids.lineUnknown } })).toBe(
      1,
    );

    imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    await restoreImportLine({
      importId: ids.importId,
      lineId: ids.lineUnknown,
      lineVersion: line.version,
      importVersion: imp.version,
    });
    line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknown },
    });
    expect(line.mappingStatus).toBe("MATCHED_SKU");
    expect(line.productId).toBe(ids.product2);
    expect(line.requirementItemId).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "OsfImport",
        entityId: ids.importId,
        actorUserId: ids.staff,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.afterJson).toMatchObject({
      event: "OSF_IMPORT_LINE_RESTORED",
    });
  });

  it("resolves an unknown brand without inventing products", async () => {
    const imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    const line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknownBrand },
    });
    const productCountBefore = await prisma.product.count({
      where: { companyId: ids.company },
    });

    await resolveImportLineBrand({
      importId: ids.importId,
      lineId: ids.lineUnknownBrand,
      lineVersion: line.version,
      importVersion: imp.version,
      brandId: ids.brandOther,
      applyToBrandGroup: true,
    });

    const updated = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknownBrand },
    });
    expect(updated.brandId).toBe(ids.brandOther);
    expect(updated.mappingStatus).toBe("UNKNOWN_SKU");
    expect(
      await prisma.product.count({ where: { companyId: ids.company } }),
    ).toBe(productCountBefore);
  });

  it("rejects cross-company import access as NOT_FOUND", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async () => ({
      ...staffUser,
      companyId: ids.otherCompany,
    }));
    await expect(getOsfImportReview(ids.importId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);
  });

  it("does not touch purchase orders", async () => {
    const po = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true, updatedAt: true },
    });
    expect(po[0]?.status).toBe("CONFIRMED");
    expect(Prisma).toBeDefined();
  });
});
