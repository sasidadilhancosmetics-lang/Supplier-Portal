/**
 * Neon development tests for OSF brand resolution and review edits.
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

describe.runIf(run)("osf import brand review (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let requireStaffPermission: ReturnType<typeof vi.fn>;
  let createBrandAndResolveImportLines: typeof import("./mutations").createBrandAndResolveImportLines;
  let includeZeroQtyLine: typeof import("./mutations").includeZeroQtyLine;
  let updateImportLineQuantity: typeof import("./mutations").updateImportLineQuantity;
  let AuthorizationError: typeof import("@/lib/auth/errors").AuthorizationError;

  const tag = `d1c_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    otherCompany: `${tag}_co2`,
    brand: `${tag}_br`,
    staff: `${tag}_st`,
    importId: `${tag}_imp`,
    lineUnknown: `${tag}_lu`,
    lineUnknownBrand: `${tag}_lub`,
    lineUnknownBrand2: `${tag}_lub2`,
    lineZero: `${tag}_lz`,
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
    ({ AuthorizationError } = await import("@/lib/auth/errors"));
    ({ requireStaffPermission } = await import("@/lib/auth/guards") as never);
    ({
      createBrandAndResolveImportLines,
      includeZeroQtyLine,
      updateImportLineQuantity,
    } = await import("./mutations"));

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
    await prisma.brand.create({
      data: { id: ids.brand, companyId: ids.company, name: `Brand ${tag}` },
    });
    await prisma.osfImport.create({
      data: {
        id: ids.importId,
        companyId: ids.company,
        idempotencyKey: `d1c-key-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        contractVersion: "cosmo-osf-push.v1",
        status: "NEEDS_REVIEW",
        payload: { test: true },
        version: 1,
      },
    });
    await prisma.osfImportLine.createMany({
      data: [
        {
          id: ids.lineUnknown,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 0,
          lineKey: `${tag}-UNK`,
          sku: `${tag}-UNK`,
          descriptionSnapshot: "Unknown SKU",
          cosmoVendorId: "vnd_a",
          brandNameSnapshot: `Brand ${tag}`,
          quantityProposed: 3,
          quantityPlanned: 3,
          mappingStatus: "UNKNOWN_SKU",
          brandId: ids.brand,
          version: 1,
        },
        {
          id: ids.lineUnknownBrand,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 1,
          lineKey: `${tag}-NB1`,
          sku: `${tag}-NB1`,
          descriptionSnapshot: "No brand 1",
          cosmoVendorId: "vnd_mystery",
          brandNameSnapshot: `Mystery ${tag}`,
          quantityProposed: 2,
          quantityPlanned: 2,
          mappingStatus: "UNKNOWN_BRAND",
          version: 1,
        },
        {
          id: ids.lineUnknownBrand2,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 2,
          lineKey: `${tag}-NB2`,
          sku: `${tag}-NB2`,
          descriptionSnapshot: "No brand 2",
          cosmoVendorId: "vnd_mystery",
          brandNameSnapshot: `Mystery ${tag}`,
          quantityProposed: 5,
          quantityPlanned: 5,
          mappingStatus: "UNKNOWN_BRAND",
          version: 1,
        },
        {
          id: ids.lineZero,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 3,
          lineKey: `${tag}-ZERO`,
          sku: `${tag}-ZERO`,
          descriptionSnapshot: "Zero",
          cosmoVendorId: "vnd_a",
          brandNameSnapshot: `Brand ${tag}`,
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
    const reqs = await prisma.requirement.findMany({
      where: { osfImportId: ids.importId },
      select: { id: true },
    });
    // Clear FKs / mapping before deleting requirement items / products.
    await prisma.osfImportLine.updateMany({
      where: { osfImportId: ids.importId },
      data: {
        mappingStatus: "EXCLUDED",
        requirementItemId: null,
        requirementId: null,
        productId: null,
        brandId: null,
      },
    });
    await prisma.requirementItem.deleteMany({
      where: { requirementId: { in: reqs.map((r) => r.id) } },
    });
    await prisma.osfImportLine.deleteMany({
      where: { osfImportId: ids.importId },
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

  it("creates brand with MANAGE_BRANDS, rematches group, preserves snapshots", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async (perm) => {
      if (
        perm === "MANAGE_BRANDS" ||
        perm === "MANAGE_REQUIREMENTS" ||
        perm === "MANAGE_PRODUCTS"
      ) {
        return staffUser;
      }
      throw new AuthorizationError("FORBIDDEN");
    });

    const imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    const line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineUnknownBrand },
    });
    const snapshotBefore = line.brandNameSnapshot;

    const result = await createBrandAndResolveImportLines({
      importId: ids.importId,
      lineId: ids.lineUnknownBrand,
      lineVersion: line.version,
      importVersion: imp.version,
      name: `NewBrand ${tag}`,
    });

    expect(result.affectedCount).toBe(2);

    const lines = await prisma.osfImportLine.findMany({
      where: {
        id: { in: [ids.lineUnknownBrand, ids.lineUnknownBrand2] },
      },
    });
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.brandId).toBe(result.brandId);
      expect(l.brandNameSnapshot).toBe(snapshotBefore);
      expect(l.mappingStatus).toBe("UNKNOWN_SKU");
    }

    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: result.brandId },
    });
    expect(brand.companyId).toBe(ids.company);
  });

  it("rejects brand create without MANAGE_BRANDS", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async (perm) => {
      if (perm === "MANAGE_BRANDS") {
        throw new AuthorizationError("FORBIDDEN");
      }
      return staffUser;
    });

    await expect(
      createBrandAndResolveImportLines({
        importId: ids.importId,
        lineId: ids.lineUnknownBrand,
        lineVersion: 1,
        importVersion: 1,
        name: "Denied Brand",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects cross-company brand create path as NOT_FOUND on resolve", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async () => ({
      ...staffUser,
      companyId: ids.otherCompany,
    }));

    // Brand create may succeed in other company; resolve must not see import.
    await expect(
      createBrandAndResolveImportLines({
        importId: ids.importId,
        lineId: ids.lineUnknownBrand2,
        lineVersion: 1,
        importVersion: 1,
        name: `XCo ${tag}`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);
  });

  it("does not make zero-qty lines orderable via quantity edit; include is explicit", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);

    const imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    const line = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineZero },
    });

    await expect(
      updateImportLineQuantity({
        importId: ids.importId,
        lineId: ids.lineZero,
        lineVersion: line.version,
        importVersion: imp.version,
        quantityPlanned: 7,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const afterDenied = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineZero },
    });
    expect(afterDenied.mappingStatus).toBe("REJECTED_ZERO_QTY");
    expect(afterDenied.quantityProposed.toString()).toBe("0");
    expect(afterDenied.requirementItemId).toBeNull();

    await includeZeroQtyLine({
      importId: ids.importId,
      lineId: ids.lineZero,
      lineVersion: afterDenied.version,
      importVersion: (
        await prisma.osfImport.findUniqueOrThrow({ where: { id: ids.importId } })
      ).version,
      quantityPlanned: 7,
    });

    const included = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineZero },
    });
    expect(included.quantityProposed.toString()).toBe("0");
    expect(included.quantityPlanned.toString()).toBe("7");
    expect(included.mappingStatus).not.toBe("REJECTED_ZERO_QTY");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "OsfImport",
        entityId: ids.importId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.afterJson).toMatchObject({
      event: "OSF_IMPORT_LINE_ZERO_QTY_INCLUDED",
    });
  });

  it("does not touch protected purchase orders", async () => {
    const po = await prisma.purchaseOrder.findMany({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true },
    });
    expect(po[0]?.status).toBe("CONFIRMED");
  });
});

