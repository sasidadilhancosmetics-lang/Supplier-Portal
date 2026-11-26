/**
 * Neon development Phase F1 guided distribution tests.
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

describe.runIf(run)("osf import distributeOsfImport (Neon)", { timeout: 60_000 }, () => {
  let prisma: typeof import("@/lib/db").prisma;
  let requireStaffPermission: ReturnType<typeof vi.fn>;
  let distributeOsfImport: typeof import("./distribute").distributeOsfImport;
  let distributeRequirement: typeof import("@/lib/requests/distribute").distributeRequirement;
  let AuthorizationError: typeof import("@/lib/auth/errors").AuthorizationError;

  const tag = `f1_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    otherCompany: `${tag}_co2`,
    brandA: `${tag}_bra`,
    brandB: `${tag}_brb`,
    productA: `${tag}_pra`,
    productB: `${tag}_prb`,
    staff: `${tag}_st`,
    supplierA: `${tag}_sa`,
    supplierB: `${tag}_sb`,
    supplierUserA: `${tag}_sua`,
    importId: `${tag}_imp`,
    reqA: `${tag}_rqa`,
    reqB: `${tag}_rqb`,
    itemA: `${tag}_ita`,
    itemB: `${tag}_itb`,
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
    ({ distributeOsfImport } = await import("./distribute"));
    ({ distributeRequirement } = await import("@/lib/requests/distribute"));

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
    await prisma.supplier.create({
      data: {
        id: ids.supplierA,
        companyId: ids.company,
        name: `Supplier A ${tag}`,
        status: "ACTIVE",
        supportsAllBrands: true,
      },
    });
    await prisma.supplier.create({
      data: {
        id: ids.supplierB,
        companyId: ids.company,
        name: `Supplier B ${tag}`,
        status: "ACTIVE",
        supportsAllBrands: false,
        brands: { create: [{ brandId: ids.brandB }] },
      },
    });
    await prisma.user.create({
      data: {
        id: ids.supplierUserA,
        companyId: ids.company,
        supplierId: ids.supplierA,
        email: `sup-a-${tag}@example.com`,
        role: "SUPPLIER",
        isActive: true,
      },
    });

    await prisma.osfImport.create({
      data: {
        id: ids.importId,
        companyId: ids.company,
        idempotencyKey: `f1-key-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        contractVersion: "cosmo-osf-push.v1",
        status: "CONFIRMED",
        payload: { test: true },
        version: 2,
        confirmedAt: new Date(),
        confirmedById: ids.staff,
      },
    });
    await prisma.requirement.createMany({
      data: [
        {
          id: ids.reqA,
          companyId: ids.company,
          brandId: ids.brandA,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — A ${tag}`,
        },
        {
          id: ids.reqB,
          companyId: ids.company,
          brandId: ids.brandB,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — B ${tag}`,
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
        },
        {
          id: ids.itemB,
          requirementId: ids.reqB,
          productId: ids.productB,
          quantityPlanned: 5,
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const companyReqs = await prisma.requirement.findMany({
      where: { companyId: ids.company },
      select: { id: true },
    });
    const reqIds = companyReqs.map((r) => r.id);
    await prisma.notification.deleteMany({
      where: { userId: { in: [ids.supplierUserA, ids.staff] } },
    });
    await prisma.requestItem.deleteMany({
      where: {
        supplierRequest: { companyId: ids.company },
      },
    });
    await prisma.supplierRequest.deleteMany({
      where: { companyId: ids.company },
    });
    await prisma.osfImportDistribution.deleteMany({
      where: { companyId: ids.company },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "OsfImport", entityId: ids.importId },
          { entityId: { in: reqIds } },
          { actorUserId: ids.staff },
        ],
      },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { startsWith: `osf.import.distribute:${ids.staff}` } },
    });
    if (reqIds.length) {
      await prisma.requirementItem.deleteMany({
        where: { requirementId: { in: reqIds } },
      });
      await prisma.requirement.deleteMany({
        where: { id: { in: reqIds } },
      });
    }
    await prisma.osfImport.deleteMany({ where: { id: ids.importId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.staff, ids.supplierUserA] } },
    });
    await prisma.supplierBrand.deleteMany({
      where: { supplierId: { in: [ids.supplierA, ids.supplierB] } },
    });
    await prisma.supplier.deleteMany({
      where: { id: { in: [ids.supplierA, ids.supplierB] } },
    });
    await prisma.product.deleteMany({
      where: { companyId: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.brand.deleteMany({
      where: { companyId: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [ids.company, ids.otherCompany] } },
    });
    await prisma.$disconnect();
  }, 60_000);

  it("distributes multi-brand ALL_MATCHING with requests, items, notifications, no POs", async () => {
    const key = randomUUID();
    const result = await distributeOsfImport({
      importId: ids.importId,
      idempotencyKey: key,
      brands: [
        { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
        { requirementId: ids.reqB, mode: "ALL_MATCHING", supplierIds: [] },
      ],
    });

    expect(result.replay).toBe(false);
    expect(result.brands.map((b) => b.status).sort()).toEqual([
      "SUCCEEDED",
      "SUCCEEDED",
    ]);

    const requests = await prisma.supplierRequest.findMany({
      where: { companyId: ids.company },
      include: { items: true },
    });
    // Brand A: supplierA only (all brands). Brand B: supplierA + supplierB.
    expect(requests).toHaveLength(3);
    const itemA = requests
      .flatMap((r) => r.items)
      .find((i) => i.requirementItemId === ids.itemA);
    expect(itemA?.quantityRequested.toString()).toBe("10");

    const planned = await prisma.requirementItem.findUniqueOrThrow({
      where: { id: ids.itemA },
    });
    expect(planned.quantityPlanned.toString()).toBe("10");

    expect(
      await prisma.notification.count({
        where: { userId: ids.supplierUserA },
      }),
    ).toBeGreaterThan(0);

    expect(
      await prisma.purchaseOrder.count({ where: { companyId: ids.company } }),
    ).toBe(0);

    const ledgers = await prisma.osfImportDistribution.findMany({
      where: { osfImportId: ids.importId },
    });
    expect(ledgers.every((l) => l.status === "SUCCEEDED")).toBe(true);
  });

  it("replays same idempotency key without duplicate requests", async () => {
    const key = randomUUID();
    // Reset ledgers to FAILED so retry can process (SUCCEEDED brands are skipped).
    // Use a fresh import-scoped scenario: same key on already-SUCCEEDED returns replay of prior aggregate.
    const firstKey = randomUUID();
    // Force a new distribute attempt that only reports ALREADY_SUCCEEDED
    const first = await distributeOsfImport({
      importId: ids.importId,
      idempotencyKey: firstKey,
      brands: [
        { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
        { requirementId: ids.reqB, mode: "ALL_MATCHING", supplierIds: [] },
      ],
    });
    expect(first.brands.every((b) => b.status === "ALREADY_SUCCEEDED")).toBe(
      true,
    );

    const before = await prisma.supplierRequest.count({
      where: { companyId: ids.company },
    });
    const replay = await distributeOsfImport({
      importId: ids.importId,
      idempotencyKey: firstKey,
      brands: [
        { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
        { requirementId: ids.reqB, mode: "ALL_MATCHING", supplierIds: [] },
      ],
    });
    expect(replay.replay).toBe(true);
    expect(
      await prisma.supplierRequest.count({ where: { companyId: ids.company } }),
    ).toBe(before);
    void key;
  });

  it("rejects same-key changed payload", async () => {
    const key = randomUUID();
    await distributeOsfImport({
      importId: ids.importId,
      idempotencyKey: key,
      brands: [
        { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
      ],
    });
    await expect(
      distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: key,
        brands: [
          {
            requirementId: ids.reqA,
            mode: "SELECTED",
            supplierIds: [ids.supplierA],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });

  it(
    "supports SELECTED mode and quantity override with acknowledgment",
    async () => {
      const reqC = `${tag}_rqc`;
      const itemC = `${tag}_itc`;
      const brandC = `${tag}_brc`;
      const productC = `${tag}_prc`;
      await prisma.brand.create({
        data: { id: brandC, companyId: ids.company, name: `Brand C ${tag}` },
      });
      await prisma.product.create({
        data: {
          id: productC,
          companyId: ids.company,
          brandId: brandC,
          name: "Prod C",
          sku: `${tag}-C`,
          isActive: true,
        },
      });
      await prisma.supplierBrand.create({
        data: { supplierId: ids.supplierA, brandId: brandC },
      });
      await prisma.requirement.create({
        data: {
          id: reqC,
          companyId: ids.company,
          brandId: brandC,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — C ${tag}`,
        },
      });
      await prisma.requirementItem.create({
        data: {
          id: itemC,
          requirementId: reqC,
          productId: productC,
          quantityPlanned: 4,
        },
      });

      const denied = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: false,
        brands: [
          {
            requirementId: reqC,
            mode: "SELECTED",
            supplierIds: [ids.supplierA],
            quantityOverrides: [
              { requirementItemId: itemC, quantityRequested: 9 },
            ],
          },
        ],
      });
      expect(
        denied.brands.find((b) => b.requirementId === reqC)?.status,
      ).toBe("FAILED");

      const failedLedger = await prisma.osfImportDistribution.findUnique({
        where: {
          osfImportId_requirementId: {
            osfImportId: ids.importId,
            requirementId: reqC,
          },
        },
      });
      expect(failedLedger?.status).toBe("FAILED");

      const ok = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: true,
        retryFailedOnly: true,
        brands: [
          {
            requirementId: reqC,
            mode: "SELECTED",
            supplierIds: [ids.supplierA],
            quantityOverrides: [
              { requirementItemId: itemC, quantityRequested: 9 },
            ],
          },
        ],
      });
      expect(
        ok.brands.some(
          (b) => b.requirementId === reqC && b.status === "SUCCEEDED",
        ),
      ).toBe(true);
      const reqItem = await prisma.requestItem.findFirst({
        where: { requirementItemId: itemC },
      });
      expect(reqItem?.quantityRequested.toString()).toBe("9");
      const planned = await prisma.requirementItem.findUniqueOrThrow({
        where: { id: itemC },
      });
      expect(planned.quantityPlanned.toString()).toBe("4");
    },
    60_000,
  );

  it("marks SKIPPED_ALREADY_REQUESTED when all matching suppliers already have requests", async () => {
    const reqD = `${tag}_rqd`;
    const itemD = `${tag}_itd`;
    const brandD = `${tag}_brd`;
    const productD = `${tag}_prd`;
    await prisma.brand.create({
      data: { id: brandD, companyId: ids.company, name: `Brand D ${tag}` },
    });
    await prisma.product.create({
      data: {
        id: productD,
        companyId: ids.company,
        brandId: brandD,
        name: "Prod D",
        sku: `${tag}-D`,
        isActive: true,
      },
    });
    await prisma.supplierBrand.create({
      data: { supplierId: ids.supplierA, brandId: brandD },
    });
    await prisma.requirement.create({
      data: {
        id: reqD,
        companyId: ids.company,
        brandId: brandD,
        osfImportId: ids.importId,
        status: "CONFIRMED",
        title: `OSF — D ${tag}`,
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: itemD,
        requirementId: reqD,
        productId: productD,
        quantityPlanned: 2,
      },
    });
    await prisma.supplierRequest.create({
      data: {
        id: `${tag}_sr_pre`,
        companyId: ids.company,
        requirementId: reqD,
        supplierId: ids.supplierA,
        brandId: brandD,
        status: "NEW",
        sentAt: new Date(),
        items: {
          create: {
            id: `${tag}_ri_pre`,
            requirementItemId: itemD,
            productId: productD,
            quantityRequested: 2,
          },
        },
      },
    });

    const result = await distributeOsfImport({
      importId: ids.importId,
      idempotencyKey: randomUUID(),
      brands: [
        { requirementId: reqD, mode: "ALL_MATCHING", supplierIds: [] },
      ],
    });
    const row = result.brands.find((b) => b.requirementId === reqD);
    expect(row?.status).toBe("SKIPPED_ALREADY_REQUESTED");
    expect(row?.requestIds).toEqual([]);

    const ledger = await prisma.osfImportDistribution.findUniqueOrThrow({
      where: {
        osfImportId_requirementId: {
          osfImportId: ids.importId,
          requirementId: reqD,
        },
      },
    });
    expect(ledger.status).toBe("SKIPPED_ALREADY_REQUESTED");
  }, 30_000);

  it("preserves manual distributeRequirement regression", async () => {
    const soloReq = `${tag}_solo`;
    const soloItem = `${tag}_solo_it`;
    await prisma.requirement.create({
      data: {
        id: soloReq,
        companyId: ids.company,
        brandId: ids.brandA,
        status: "CONFIRMED",
        title: `Manual ${tag}`,
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: soloItem,
        requirementId: soloReq,
        productId: ids.productA,
        quantityPlanned: 7,
      },
    });
    const result = await distributeRequirement({
      requirementId: soloReq,
      mode: "ALL_MATCHING",
      supplierIds: [],
    });
    expect(result.count).toBeGreaterThan(0);
    const items = await prisma.requestItem.findMany({
      where: { requirementItemId: soloItem },
    });
    expect(items[0]?.quantityRequested.toString()).toBe("7");

    await prisma.requestItem.deleteMany({
      where: { requirementItemId: soloItem },
    });
    await prisma.supplierRequest.deleteMany({
      where: { requirementId: soloReq },
    });
    await prisma.requirementItem.delete({ where: { id: soloItem } });
    await prisma.requirement.delete({ where: { id: soloReq } });
  });

  it("cross-company access is NOT_FOUND", async () => {
    vi.mocked(requireStaffPermission).mockImplementationOnce(async () => ({
      ...staffUser,
      companyId: ids.otherCompany,
      id: `${tag}_other_staff`,
    }));
    // other company staff user may not exist — guard uses companyId on findFirst
    await expect(
      distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        brands: [
          { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    void AuthorizationError;
  });

  it("does not touch protected purchase orders", async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true },
    });
    expect(po?.status).toBe("CONFIRMED");
    expect(
      await prisma.purchaseOrder.count({ where: { companyId: ids.company } }),
    ).toBe(0);
  });

  it(
    "handles concurrent different-key submissions without duplicate requests for SUCCEEDED brands",
    async () => {
      const reqE = `${tag}_rqe`;
      const itemE = `${tag}_ite`;
      const brandE = `${tag}_bre`;
      const productE = `${tag}_pre`;
      await prisma.brand.create({
        data: { id: brandE, companyId: ids.company, name: `Brand E ${tag}` },
      });
      await prisma.product.create({
        data: {
          id: productE,
          companyId: ids.company,
          brandId: brandE,
          name: "Prod E",
          sku: `${tag}-E`,
          isActive: true,
        },
      });
      await prisma.supplierBrand.create({
        data: { supplierId: ids.supplierA, brandId: brandE },
      });
      await prisma.requirement.create({
        data: {
          id: reqE,
          companyId: ids.company,
          brandId: brandE,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — E ${tag}`,
        },
      });
      await prisma.requirementItem.create({
        data: {
          id: itemE,
          requirementId: reqE,
          productId: productE,
          quantityPlanned: 3,
        },
      });

      const payload = {
        importId: ids.importId,
        brands: [
          {
            requirementId: reqE,
            mode: "ALL_MATCHING" as const,
            supplierIds: [],
          },
        ],
      };
      const [a, b] = await Promise.all([
        distributeOsfImport({ ...payload, idempotencyKey: randomUUID() }),
        distributeOsfImport({ ...payload, idempotencyKey: randomUUID() }),
      ]);
      const statuses = [...a.brands, ...b.brands]
        .filter((r) => r.requirementId === reqE)
        .map((r) => r.status);
      expect(statuses).toContain("SUCCEEDED");
      expect(
        statuses.every(
          (s) =>
            s === "SUCCEEDED" ||
            s === "ALREADY_SUCCEEDED" ||
            s === "FAILED" ||
            s === "SKIPPED_ALREADY_REQUESTED",
        ),
      ).toBe(true);

      const requestCount = await prisma.supplierRequest.count({
        where: { requirementId: reqE },
      });
      expect(requestCount).toBe(1);
    },
    60_000,
  );

  it(
    "F2C supplierRecipients: different qty per supplier, ignore omitted, over-qty ack, no POs",
    async () => {
      const reqF = `${tag}_rqf`;
      const itemF = `${tag}_itf`;
      const brandF = `${tag}_brf`;
      const productF = `${tag}_prf`;
      await prisma.brand.create({
        data: { id: brandF, companyId: ids.company, name: `Brand F ${tag}` },
      });
      await prisma.product.create({
        data: {
          id: productF,
          companyId: ids.company,
          brandId: brandF,
          name: "Prod F",
          sku: `${tag}-F`,
          isActive: true,
        },
      });
      await prisma.supplierBrand.createMany({
        data: [
          { supplierId: ids.supplierA, brandId: brandF },
          { supplierId: ids.supplierB, brandId: brandF },
        ],
      });
      await prisma.requirement.create({
        data: {
          id: reqF,
          companyId: ids.company,
          brandId: brandF,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — F ${tag}`,
        },
      });
      await prisma.requirementItem.create({
        data: {
          id: itemF,
          requirementId: reqF,
          productId: productF,
          quantityPlanned: 10,
        },
      });

      const denied = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: false,
        brands: [
          {
            requirementId: reqF,
            mode: "SELECTED",
            supplierIds: [ids.supplierA, ids.supplierB],
            supplierRecipients: [
              {
                supplierId: ids.supplierA,
                items: [{ requirementItemId: itemF, quantityRequested: 8 }],
              },
              {
                supplierId: ids.supplierB,
                items: [{ requirementItemId: itemF, quantityRequested: 5 }],
              },
            ],
          },
        ],
      });
      expect(
        denied.brands.find((b) => b.requirementId === reqF)?.status,
      ).toBe("FAILED");

      const ok = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: true,
        retryFailedOnly: true,
        brands: [
          {
            requirementId: reqF,
            mode: "SELECTED",
            supplierIds: [ids.supplierA, ids.supplierB],
            // supplierB ignored (empty / omitted) — must not get planned fallback
            supplierRecipients: [
              {
                supplierId: ids.supplierA,
                items: [{ requirementItemId: itemF, quantityRequested: 4 }],
              },
              {
                supplierId: ids.supplierB,
                items: [{ requirementItemId: itemF, quantityRequested: 3 }],
              },
            ],
          },
        ],
      });
      expect(
        ok.brands.some(
          (b) => b.requirementId === reqF && b.status === "SUCCEEDED",
        ),
      ).toBe(true);

      const requests = await prisma.supplierRequest.findMany({
        where: { requirementId: reqF },
        include: { items: true },
      });
      expect(requests).toHaveLength(2);
      const bySupplier = new Map(
        requests.map((r) => [r.supplierId, r.items[0]?.quantityRequested.toString()]),
      );
      expect(bySupplier.get(ids.supplierA)).toBe("4");
      expect(bySupplier.get(ids.supplierB)).toBe("3");

      const planned = await prisma.requirementItem.findUniqueOrThrow({
        where: { id: itemF },
      });
      expect(planned.quantityPlanned.toString()).toBe("10");

      expect(
        await prisma.purchaseOrder.count({ where: { companyId: ids.company } }),
      ).toBe(0);

      // Partial: only supplierA — ignored supplierB must not receive qty
      const reqG = `${tag}_rqg`;
      const itemG = `${tag}_itg`;
      const brandG = `${tag}_brg`;
      const productG = `${tag}_prg`;
      await prisma.brand.create({
        data: { id: brandG, companyId: ids.company, name: `Brand G ${tag}` },
      });
      await prisma.product.create({
        data: {
          id: productG,
          companyId: ids.company,
          brandId: brandG,
          name: "Prod G",
          sku: `${tag}-G`,
          isActive: true,
        },
      });
      await prisma.supplierBrand.createMany({
        data: [
          { supplierId: ids.supplierA, brandId: brandG },
          { supplierId: ids.supplierB, brandId: brandG },
        ],
      });
      await prisma.requirement.create({
        data: {
          id: reqG,
          companyId: ids.company,
          brandId: brandG,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `OSF — G ${tag}`,
        },
      });
      await prisma.requirementItem.create({
        data: {
          id: itemG,
          requirementId: reqG,
          productId: productG,
          quantityPlanned: 10,
        },
      });
      const partial = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        brands: [
          {
            requirementId: reqG,
            mode: "SELECTED",
            supplierIds: [ids.supplierA],
            supplierRecipients: [
              {
                supplierId: ids.supplierA,
                items: [{ requirementItemId: itemG, quantityRequested: 2 }],
              },
            ],
          },
        ],
      });
      expect(
        partial.brands.find((b) => b.requirementId === reqG)?.status,
      ).toBe("SUCCEEDED");
      expect(
        await prisma.supplierRequest.count({ where: { requirementId: reqG } }),
      ).toBe(1);
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: reqG, supplierId: ids.supplierB },
        }),
      ).toBe(0);
    },
    60_000,
  );
});
