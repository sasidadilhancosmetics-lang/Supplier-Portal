/**
 * Neon development Phase E bulk confirm tests.
 * Skips unless RUN_DB_INTEGRATION=1. Disposable fixtures cleaned in afterAll.
 */
import { randomBytes, randomUUID } from "node:crypto";

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

describe.runIf(run)("osf import confirmOsfImport (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let requireStaffPermission: ReturnType<typeof vi.fn>;
  let confirmOsfImport: typeof import("./confirm").confirmOsfImport;
  let confirmRequirement: typeof import("@/lib/requirements/mutations").confirmRequirement;
  let AuthorizationError: typeof import("@/lib/auth/errors").AuthorizationError;

  const tag = `e_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    otherCompany: `${tag}_co2`,
    brandA: `${tag}_bra`,
    brandB: `${tag}_brb`,
    productA: `${tag}_pra`,
    productB: `${tag}_prb`,
    staff: `${tag}_st`,
    importId: `${tag}_imp`,
    reqA: `${tag}_rqa`,
    reqB: `${tag}_rqb`,
    itemA: `${tag}_ita`,
    itemB: `${tag}_itb`,
    lineA: `${tag}_la`,
    lineB: `${tag}_lb`,
    lineZero: `${tag}_lz`,
    soloReq: `${tag}_solo_rq`,
    soloItem: `${tag}_solo_it`,
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
    ({ confirmOsfImport } = await import("./confirm"));
    ({ confirmRequirement } = await import("@/lib/requirements/mutations"));

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
        { id: ids.brandA, companyId: ids.company, name: `Brand A ${tag}` },
        { id: ids.brandB, companyId: ids.company, name: `Brand B ${tag}` },
      ],
    });
    await prisma.product.createMany({
      data: [
        {
          id: ids.productA,
          companyId: ids.company,
          brandId: ids.brandA,
          name: "Prod A",
          sku: `${tag}-A`,
          isActive: true,
        },
        {
          id: ids.productB,
          companyId: ids.company,
          brandId: ids.brandB,
          name: "Prod B",
          sku: `${tag}-B`,
          isActive: true,
        },
      ],
    });

    await prisma.osfImport.create({
      data: {
        id: ids.importId,
        companyId: ids.company,
        idempotencyKey: `e-key-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        contractVersion: "cosmo-osf-push.v1",
        status: "READY_TO_CONFIRM",
        payload: { test: true },
        version: 1,
      },
    });

    await prisma.requirement.createMany({
      data: [
        {
          id: ids.reqA,
          companyId: ids.company,
          brandId: ids.brandA,
          osfImportId: ids.importId,
          status: "DRAFT",
          title: `OSF — A ${tag}`,
        },
        {
          id: ids.reqB,
          companyId: ids.company,
          brandId: ids.brandB,
          osfImportId: ids.importId,
          status: "DRAFT",
          title: `OSF — B ${tag}`,
        },
        {
          id: ids.soloReq,
          companyId: ids.company,
          brandId: ids.brandA,
          status: "DRAFT",
          title: `Solo ${tag}`,
        },
      ],
    });
    await prisma.requirementItem.createMany({
      data: [
        {
          id: ids.itemA,
          requirementId: ids.reqA,
          productId: ids.productA,
          quantityPlanned: 10,
          externalLineId: `${tag}-A`,
        },
        {
          id: ids.itemB,
          requirementId: ids.reqB,
          productId: ids.productB,
          quantityPlanned: 5,
          externalLineId: `${tag}-B`,
        },
        {
          id: ids.soloItem,
          requirementId: ids.soloReq,
          productId: ids.productA,
          quantityPlanned: 3,
        },
      ],
    });
    await prisma.osfImportLine.createMany({
      data: [
        {
          id: ids.lineA,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 0,
          lineKey: `${tag}-A`,
          sku: `${tag}-A`,
          descriptionSnapshot: "A",
          cosmoVendorId: "vnd_a",
          brandNameSnapshot: `Brand A ${tag}`,
          quantityProposed: 10,
          quantityPlanned: 10,
          mappingStatus: "MATCHED_SKU",
          brandId: ids.brandA,
          productId: ids.productA,
          requirementId: ids.reqA,
          requirementItemId: ids.itemA,
          version: 1,
        },
        {
          id: ids.lineB,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 1,
          lineKey: `${tag}-B`,
          sku: `${tag}-B`,
          descriptionSnapshot: "B",
          cosmoVendorId: "vnd_b",
          brandNameSnapshot: `Brand B ${tag}`,
          quantityProposed: 5,
          quantityPlanned: 5,
          mappingStatus: "MATCHED_SKU",
          brandId: ids.brandB,
          productId: ids.productB,
          requirementId: ids.reqB,
          requirementItemId: ids.itemB,
          version: 1,
        },
        {
          id: ids.lineZero,
          companyId: ids.company,
          osfImportId: ids.importId,
          sourceIndex: 2,
          lineKey: `${tag}-ZERO`,
          sku: `${tag}-ZERO`,
          descriptionSnapshot: "Zero",
          cosmoVendorId: "vnd_a",
          brandNameSnapshot: `Brand A ${tag}`,
          quantityProposed: 0,
          quantityPlanned: 0,
          mappingStatus: "REJECTED_ZERO_QTY",
          brandId: ids.brandA,
          version: 1,
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
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
    await prisma.osfImportLine.deleteMany({
      where: { osfImportId: ids.importId },
    });
    await prisma.requirementItem.deleteMany({
      where: {
        requirementId: { in: [ids.reqA, ids.reqB, ids.soloReq] },
      },
    });
    await prisma.requirement.deleteMany({
      where: { id: { in: [ids.reqA, ids.reqB, ids.soloReq] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "OsfImport", entityId: ids.importId },
          { entityId: { in: [ids.reqA, ids.reqB, ids.soloReq] } },
          { actorUserId: ids.staff },
        ],
      },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { startsWith: `osf.import.confirm:${ids.staff}` } },
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

  it("confirms multi-brand import atomically with audits and zero-qty left rejected", async () => {
    const key = randomUUID();
    const result = await confirmOsfImport({
      importId: ids.importId,
      importVersion: 1,
      idempotencyKey: key,
    });

    expect(result.status).toBe("CONFIRMED");
    expect(result.replay).toBe(false);
    expect(result.confirmedRequirementIds.sort()).toEqual(
      [ids.reqA, ids.reqB].sort(),
    );
    expect(result.itemCount).toBe(2);

    const imp = await prisma.osfImport.findUniqueOrThrow({
      where: { id: ids.importId },
    });
    expect(imp.status).toBe("CONFIRMED");
    expect(imp.confirmedById).toBe(ids.staff);
    expect(imp.confirmedAt).not.toBeNull();
    expect(imp.version).toBe(2);

    const reqs = await prisma.requirement.findMany({
      where: { id: { in: [ids.reqA, ids.reqB] } },
    });
    expect(reqs.every((r) => r.status === "CONFIRMED")).toBe(true);

    const zero = await prisma.osfImportLine.findUniqueOrThrow({
      where: { id: ids.lineZero },
    });
    expect(zero.mappingStatus).toBe("REJECTED_ZERO_QTY");

    const importAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: "OsfImport",
        entityId: ids.importId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(importAudit?.afterJson).toMatchObject({
      event: "OSF_IMPORT_CONFIRMED",
      suppliersNotified: false,
    });

    const reqAudits = await prisma.auditLog.count({
      where: {
        entityType: "Requirement",
        entityId: { in: [ids.reqA, ids.reqB] },
        action: "STATUS_CHANGE",
      },
    });
    expect(reqAudits).toBe(2);

    expect(
      await prisma.supplierRequest.count({
        where: { companyId: ids.company },
      }),
    ).toBe(0);
  });

  it("replays same idempotency key without duplicate audits", async () => {
    const key = randomUUID();
    // First call already confirmed — use new key stored from prior test's state
    // Re-confirm with a fresh key against already CONFIRMED should short-circuit.
    const first = await confirmOsfImport({
      importId: ids.importId,
      importVersion: 2,
      idempotencyKey: key,
    });
    expect(first.status).toBe("CONFIRMED");
    expect(first.already).toBe(true);

    const auditsBefore = await prisma.auditLog.count({
      where: { entityType: "OsfImport", entityId: ids.importId },
    });

    const replay = await confirmOsfImport({
      importId: ids.importId,
      importVersion: 2,
      idempotencyKey: key,
    });
    expect(replay.replay).toBe(true);
    expect(replay.importId).toBe(ids.importId);

    const auditsAfter = await prisma.auditLog.count({
      where: { entityType: "OsfImport", entityId: ids.importId },
    });
    expect(auditsAfter).toBe(auditsBefore);
  });

  it("rejects same idempotency key with different request hash", async () => {
    const key = randomUUID();
    await confirmOsfImport({
      importId: ids.importId,
      importVersion: 2,
      idempotencyKey: key,
    });
    await expect(
      confirmOsfImport({
        importId: ids.importId,
        importVersion: 99,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });

  it("rejects stale import version on a fresh READY import", async () => {
    // Build a second READY import for version conflict
    const imp2 = `${tag}_imp2`;
    const req2 = `${tag}_rq2`;
    const item2 = `${tag}_it2`;
    const line2 = `${tag}_l2`;
    await prisma.osfImport.create({
      data: {
        id: imp2,
        companyId: ids.company,
        idempotencyKey: `e-key2-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        status: "READY_TO_CONFIRM",
        payload: {},
        version: 3,
      },
    });
    await prisma.requirement.create({
      data: {
        id: req2,
        companyId: ids.company,
        brandId: ids.brandA,
        osfImportId: imp2,
        status: "DRAFT",
        title: "v conflict",
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: item2,
        requirementId: req2,
        productId: ids.productA,
        quantityPlanned: 1,
      },
    });
    await prisma.osfImportLine.create({
      data: {
        id: line2,
        companyId: ids.company,
        osfImportId: imp2,
        sourceIndex: 0,
        lineKey: `${tag}-V`,
        sku: `${tag}-V`,
        descriptionSnapshot: "V",
        brandNameSnapshot: "A",
        quantityProposed: 1,
        quantityPlanned: 1,
        mappingStatus: "MATCHED_SKU",
        brandId: ids.brandA,
        productId: ids.productA,
        requirementId: req2,
        requirementItemId: item2,
        version: 1,
      },
    });

    await expect(
      confirmOsfImport({
        importId: imp2,
        importVersion: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    // cleanup secondary
    await prisma.osfImportLine.updateMany({
      where: { id: line2 },
      data: {
        mappingStatus: "EXCLUDED",
        requirementItemId: null,
        requirementId: null,
        productId: null,
        brandId: null,
      },
    });
    await prisma.requirementItem.delete({ where: { id: item2 } });
    await prisma.osfImportLine.delete({ where: { id: line2 } });
    await prisma.requirement.delete({ where: { id: req2 } });
    await prisma.osfImport.delete({ where: { id: imp2 } });
  });

  it("rejects cross-company access as NOT_FOUND", async () => {
    vi.mocked(requireStaffPermission).mockImplementation(async () => ({
      ...staffUser,
      companyId: ids.otherCompany,
    }));
    await expect(
      confirmOsfImport({
        importId: ids.importId,
        importVersion: 2,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);
  });

  it("rejects without CONFIRM_REQUIREMENT", async () => {
    vi.mocked(requireStaffPermission).mockRejectedValue(
      new AuthorizationError("FORBIDDEN"),
    );
    await expect(
      confirmOsfImport({
        importId: ids.importId,
        importVersion: 2,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);
  });

  it("rolls back if a requirement cannot be confirmed mid-batch", async () => {
    const imp3 = `${tag}_imp3`;
    const reqOk = `${tag}_rqok`;
    const reqBad = `${tag}_rqbad`;
    const itemOk = `${tag}_itok`;
    const lineOk = `${tag}_lok`;
    const lineBad = `${tag}_lbad`;

    await prisma.osfImport.create({
      data: {
        id: imp3,
        companyId: ids.company,
        idempotencyKey: `e-key3-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        status: "READY_TO_CONFIRM",
        payload: {},
        version: 1,
      },
    });
    await prisma.requirement.createMany({
      data: [
        {
          id: reqOk,
          companyId: ids.company,
          brandId: ids.brandA,
          osfImportId: imp3,
          status: "DRAFT",
          title: "ok",
        },
        {
          id: reqBad,
          companyId: ids.company,
          brandId: ids.brandB,
          osfImportId: imp3,
          status: "DRAFT",
          title: "bad empty",
        },
      ],
    });
    await prisma.requirementItem.create({
      data: {
        id: itemOk,
        requirementId: reqOk,
        productId: ids.productA,
        quantityPlanned: 2,
      },
    });
    // Only one matched line; empty draft reqBad remains to force rollback.
    await prisma.osfImportLine.create({
      data: {
        id: lineOk,
        companyId: ids.company,
        osfImportId: imp3,
        sourceIndex: 0,
        lineKey: `${tag}-OK`,
        sku: `${tag}-OK`,
        descriptionSnapshot: "ok",
        brandNameSnapshot: "A",
        quantityProposed: 2,
        quantityPlanned: 2,
        mappingStatus: "MATCHED_SKU",
        brandId: ids.brandA,
        productId: ids.productA,
        requirementId: reqOk,
        requirementItemId: itemOk,
        version: 1,
      },
    });
    void lineBad;

    await expect(
      confirmOsfImport({
        importId: imp3,
        importVersion: 1,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID_STATE|NOT_READY/),
    });

    const imp = await prisma.osfImport.findUniqueOrThrow({ where: { id: imp3 } });
    expect(imp.status).toBe("READY_TO_CONFIRM");
    const req = await prisma.requirement.findUniqueOrThrow({ where: { id: reqOk } });
    expect(req.status).toBe("DRAFT");

    await prisma.osfImportLine.updateMany({
      where: { osfImportId: imp3 },
      data: {
        mappingStatus: "EXCLUDED",
        requirementItemId: null,
        requirementId: null,
        productId: null,
        brandId: null,
      },
    });
    await prisma.requirementItem.deleteMany({ where: { id: itemOk } });
    await prisma.osfImportLine.deleteMany({ where: { osfImportId: imp3 } });
    await prisma.requirement.deleteMany({
      where: { id: { in: [reqOk, reqBad] } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { startsWith: `osf.import.confirm:${ids.staff}` } },
    });
    await prisma.osfImport.delete({ where: { id: imp3 } });
  });

  it("preserves single-requirement confirm regression", async () => {
    const result = await confirmRequirement({ requirementId: ids.soloReq });
    expect(result.status).toBe("CONFIRMED");
    expect(result.already).toBe(false);
    const again = await confirmRequirement({ requirementId: ids.soloReq });
    expect(again.already).toBe(true);
  });

  it("does not touch protected purchase orders", async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true },
    });
    expect(po?.status).toBe("CONFIRMED");
    expect(
      await prisma.purchaseOrder.count({
        where: { companyId: ids.company },
      }),
    ).toBe(0);
  });

  it("handles concurrent double-submit with one success", async () => {
    const imp4 = `${tag}_imp4`;
    const req4 = `${tag}_rq4`;
    const item4 = `${tag}_it4`;
    const line4 = `${tag}_l4`;
    await prisma.osfImport.create({
      data: {
        id: imp4,
        companyId: ids.company,
        idempotencyKey: `e-key4-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        status: "READY_TO_CONFIRM",
        payload: {},
        version: 1,
      },
    });
    await prisma.requirement.create({
      data: {
        id: req4,
        companyId: ids.company,
        brandId: ids.brandA,
        osfImportId: imp4,
        status: "DRAFT",
        title: "concurrent",
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: item4,
        requirementId: req4,
        productId: ids.productA,
        quantityPlanned: 4,
      },
    });
    await prisma.osfImportLine.create({
      data: {
        id: line4,
        companyId: ids.company,
        osfImportId: imp4,
        sourceIndex: 0,
        lineKey: `${tag}-C`,
        sku: `${tag}-C`,
        descriptionSnapshot: "C",
        brandNameSnapshot: "A",
        quantityProposed: 4,
        quantityPlanned: 4,
        mappingStatus: "MATCHED_SKU",
        brandId: ids.brandA,
        productId: ids.productA,
        requirementId: req4,
        requirementItemId: item4,
        version: 1,
      },
    });

    const keyA = randomUUID();
    const keyB = randomUUID();
    const outcomes = await Promise.allSettled([
      confirmOsfImport({
        importId: imp4,
        importVersion: 1,
        idempotencyKey: keyA,
      }),
      confirmOsfImport({
        importId: imp4,
        importVersion: 1,
        idempotencyKey: keyB,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toMatchObject({
        code: "VERSION_CONFLICT",
      });
    }

    const imp = await prisma.osfImport.findUniqueOrThrow({ where: { id: imp4 } });
    expect(imp.status).toBe("CONFIRMED");

    await prisma.osfImportLine.updateMany({
      where: { id: line4 },
      data: {
        mappingStatus: "EXCLUDED",
        requirementItemId: null,
        requirementId: null,
        productId: null,
        brandId: null,
      },
    });
    await prisma.requirementItem.delete({ where: { id: item4 } });
    await prisma.osfImportLine.delete({ where: { id: line4 } });
    await prisma.requirement.delete({ where: { id: req4 } });
    await prisma.osfImport.delete({ where: { id: imp4 } });
  });
});
