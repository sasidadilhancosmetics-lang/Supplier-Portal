/**
 * Phase F1 final safety verification (Neon development).
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

describe.runIf(run)(
  "osf import distribute F1 safety (Neon)",
  { timeout: 90_000 },
  () => {
    let prisma: typeof import("@/lib/db").prisma;
    let requireStaffPermission: ReturnType<typeof vi.fn>;
    let distributeOsfImport: typeof import("./distribute").distributeOsfImport;
    let distributeRequirement: typeof import("@/lib/requests/distribute").distributeRequirement;
    let osfImportDistributeIdempotencyScope: typeof import("./distribute").osfImportDistributeIdempotencyScope;

    const tag = `f1s_${Date.now().toString(36)}`;
    const ids = {
      company: `${tag}_co`,
      brandA: `${tag}_bra`,
      brandB: `${tag}_brb`,
      brandC: `${tag}_brc`,
      brandLock: `${tag}_brl`,
      brandExpire: `${tag}_bre`,
      brandConc: `${tag}_brn`,
      brandQty: `${tag}_brq`,
      productA: `${tag}_pra`,
      productB: `${tag}_prb`,
      productC: `${tag}_prc`,
      productLock: `${tag}_prl`,
      productExpire: `${tag}_pre`,
      productConc: `${tag}_prn`,
      productQty: `${tag}_prq`,
      staff: `${tag}_st`,
      supplierAll: `${tag}_sa`,
      supplierQty2: `${tag}_sq2`,
      supplierUser: `${tag}_su`,
      importId: `${tag}_imp`,
      reqA: `${tag}_rqa`,
      reqB: `${tag}_rqb`,
      reqC: `${tag}_rqc`,
      reqLock: `${tag}_rql`,
      reqExpire: `${tag}_rqe`,
      reqConc: `${tag}_rqn`,
      reqQty: `${tag}_rqq`,
      itemA: `${tag}_ita`,
      itemB: `${tag}_itb`,
      itemC: `${tag}_itc`,
      itemLock: `${tag}_itl`,
      itemExpire: `${tag}_ite`,
      itemConc: `${tag}_itn`,
      itemQty: `${tag}_itq`,
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

    async function countRequirementAudits(requirementId: string) {
      return prisma.auditLog.count({
        where: {
          entityType: "Requirement",
          entityId: requirementId,
          action: "UPDATE",
        },
      });
    }

    async function countImportDistributeAudits() {
      return prisma.auditLog.count({
        where: {
          entityType: "OsfImport",
          entityId: ids.importId,
        },
      });
    }

    beforeAll(async () => {
      ({ prisma } = await import("@/lib/db"));
      ({ requireStaffPermission } = await import("@/lib/auth/guards") as never);
      ({
        distributeOsfImport,
        osfImportDistributeIdempotencyScope,
      } = await import("./distribute"));
      ({ distributeRequirement } = await import("@/lib/requests/distribute"));
      vi.mocked(requireStaffPermission).mockImplementation(async () => staffUser);

      await prisma.company.create({
        data: { id: ids.company, name: `Co ${tag}` },
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
          { id: ids.brandA, companyId: ids.company, name: `A ${tag}` },
          { id: ids.brandB, companyId: ids.company, name: `B ${tag}` },
          { id: ids.brandC, companyId: ids.company, name: `C ${tag}` },
          { id: ids.brandLock, companyId: ids.company, name: `Lock ${tag}` },
          { id: ids.brandExpire, companyId: ids.company, name: `Expire ${tag}` },
          { id: ids.brandConc, companyId: ids.company, name: `Conc ${tag}` },
          { id: ids.brandQty, companyId: ids.company, name: `Qty ${tag}` },
        ],
      });
      await prisma.product.createMany({
        data: [
          {
            id: ids.productA,
            companyId: ids.company,
            brandId: ids.brandA,
            name: "A",
            sku: `${tag}-A`,
            isActive: true,
          },
          {
            id: ids.productB,
            companyId: ids.company,
            brandId: ids.brandB,
            name: "B",
            sku: `${tag}-B`,
            isActive: true,
          },
          {
            id: ids.productC,
            companyId: ids.company,
            brandId: ids.brandC,
            name: "C",
            sku: `${tag}-C`,
            isActive: true,
          },
          {
            id: ids.productLock,
            companyId: ids.company,
            brandId: ids.brandLock,
            name: "Lock",
            sku: `${tag}-L`,
            isActive: true,
          },
          {
            id: ids.productExpire,
            companyId: ids.company,
            brandId: ids.brandExpire,
            name: "Expire",
            sku: `${tag}-E`,
            isActive: true,
          },
          {
            id: ids.productConc,
            companyId: ids.company,
            brandId: ids.brandConc,
            name: "Conc",
            sku: `${tag}-N`,
            isActive: true,
          },
          {
            id: ids.productQty,
            companyId: ids.company,
            brandId: ids.brandQty,
            name: "Qty",
            sku: `${tag}-Q`,
            isActive: true,
          },
        ],
      });

      await prisma.supplier.create({
        data: {
          id: ids.supplierAll,
          companyId: ids.company,
          name: `All ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
        },
      });
      await prisma.supplier.create({
        data: {
          id: ids.supplierQty2,
          companyId: ids.company,
          name: `Qty2 ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: false,
          brands: { create: [{ brandId: ids.brandQty }] },
        },
      });
      await prisma.user.create({
        data: {
          id: ids.supplierUser,
          companyId: ids.company,
          supplierId: ids.supplierAll,
          email: `sup-${tag}@example.com`,
          role: "SUPPLIER",
          isActive: true,
        },
      });

      await prisma.osfImport.create({
        data: {
          id: ids.importId,
          companyId: ids.company,
          idempotencyKey: `f1s-key-${tag}`,
          payloadHash: randomBytes(32).toString("hex"),
          contractVersion: "cosmo-osf-push.v1",
          status: "CONFIRMED",
          payload: { test: true },
          version: 2,
          confirmedAt: new Date(),
          confirmedById: ids.staff,
        },
      });

      const reqRows = [
        [ids.reqA, ids.brandA, ids.itemA, ids.productA, "10"],
        [ids.reqB, ids.brandB, ids.itemB, ids.productB, "5"],
        [ids.reqC, ids.brandC, ids.itemC, ids.productC, "8"],
        [ids.reqLock, ids.brandLock, ids.itemLock, ids.productLock, "3"],
        [ids.reqExpire, ids.brandExpire, ids.itemExpire, ids.productExpire, "2"],
        [ids.reqConc, ids.brandConc, ids.itemConc, ids.productConc, "4"],
        [ids.reqQty, ids.brandQty, ids.itemQty, ids.productQty, "6"],
      ] as const;

      for (const [reqId, brandId, itemId, productId, qty] of reqRows) {
        await prisma.requirement.create({
          data: {
            id: reqId,
            companyId: ids.company,
            brandId,
            osfImportId: ids.importId,
            status: "CONFIRMED",
            title: `Req ${reqId}`,
          },
        });
        await prisma.requirementItem.create({
          data: {
            id: itemId,
            requirementId: reqId,
            productId,
            quantityPlanned: qty,
          },
        });
      }
    }, 90_000);

    afterAll(async () => {
      if (!prisma) return;
      const companyReqs = await prisma.requirement.findMany({
        where: { companyId: ids.company },
        select: { id: true },
      });
      const reqIds = companyReqs.map((r) => r.id);
      await prisma.notification.deleteMany({
        where: { userId: { in: [ids.supplierUser, ids.staff] } },
      });
      await prisma.requestItem.deleteMany({
        where: { supplierRequest: { companyId: ids.company } },
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
        where: {
          scope: { startsWith: osfImportDistributeIdempotencyScope(ids.staff) },
        },
      });
      if (reqIds.length) {
        await prisma.requirementItem.deleteMany({
          where: { requirementId: { in: reqIds } },
        });
        await prisma.requirement.deleteMany({ where: { id: { in: reqIds } } });
      }
      await prisma.osfImport.deleteMany({ where: { id: ids.importId } });
      await prisma.user.deleteMany({
        where: { id: { in: [ids.staff, ids.supplierUser] } },
      });
      await prisma.supplierBrand.deleteMany({
        where: { supplierId: { in: [ids.supplierAll, ids.supplierQty2] } },
      });
      await prisma.supplier.deleteMany({
        where: { id: { in: [ids.supplierAll, ids.supplierQty2] } },
      });
      await prisma.product.deleteMany({ where: { companyId: ids.company } });
      await prisma.brand.deleteMany({ where: { companyId: ids.company } });
      await prisma.company.deleteMany({ where: { id: ids.company } });
      await prisma.$disconnect();
    }, 90_000);

    it("partial A/C success + B fail then retry-failed only with new key", async () => {
      const firstKey = randomUUID();
      const first = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: firstKey,
        acknowledgeOverQty: false,
        brands: [
          { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
          {
            requirementId: ids.reqB,
            mode: "ALL_MATCHING",
            supplierIds: [],
            quantityOverrides: [
              { requirementItemId: ids.itemB, quantityRequested: 99 },
            ],
          },
          { requirementId: ids.reqC, mode: "ALL_MATCHING", supplierIds: [] },
        ],
      });

      const byReq = Object.fromEntries(
        first.brands.map((b) => [b.requirementId, b.status]),
      );
      expect(byReq[ids.reqA]).toBe("SUCCEEDED");
      expect(byReq[ids.reqB]).toBe("FAILED");
      expect(byReq[ids.reqC]).toBe("SUCCEEDED");

      const reqACount = await prisma.supplierRequest.count({
        where: { requirementId: ids.reqA },
      });
      const reqCCount = await prisma.supplierRequest.count({
        where: { requirementId: ids.reqC },
      });
      const reqBCountBefore = await prisma.supplierRequest.count({
        where: { requirementId: ids.reqB },
      });
      expect(reqBCountBefore).toBe(0);

      const notifBeforeRetry = await prisma.notification.count({
        where: { userId: ids.supplierUser },
      });
      const auditABefore = await countRequirementAudits(ids.reqA);
      const auditCBefore = await countRequirementAudits(ids.reqC);
      const auditBBefore = await countRequirementAudits(ids.reqB);
      expect(auditABefore).toBe(1);
      expect(auditCBefore).toBe(1);
      expect(auditBBefore).toBe(0);

      // Old key must replay original mixed response (no side effects).
      const replay = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: firstKey,
        acknowledgeOverQty: false,
        brands: [
          { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
          {
            requirementId: ids.reqB,
            mode: "ALL_MATCHING",
            supplierIds: [],
            quantityOverrides: [
              { requirementItemId: ids.itemB, quantityRequested: 99 },
            ],
          },
          { requirementId: ids.reqC, mode: "ALL_MATCHING", supplierIds: [] },
        ],
      });
      expect(replay.replay).toBe(true);
      expect(
        replay.brands.find((b) => b.requirementId === ids.reqB)?.status,
      ).toBe("FAILED");
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqB },
        }),
      ).toBe(0);

      // Retry failed only — new idempotency key (wizard always mints UUID).
      const retryKey = randomUUID();
      expect(retryKey).not.toBe(firstKey);
      const retry = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: retryKey,
        acknowledgeOverQty: true,
        retryFailedOnly: true,
        brands: [
          { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
          {
            requirementId: ids.reqB,
            mode: "ALL_MATCHING",
            supplierIds: [],
            quantityOverrides: [
              { requirementItemId: ids.itemB, quantityRequested: 99 },
            ],
          },
          { requirementId: ids.reqC, mode: "ALL_MATCHING", supplierIds: [] },
        ],
      });

      expect(
        retry.brands.find((b) => b.requirementId === ids.reqB)?.status,
      ).toBe("SUCCEEDED");
      expect(
        retry.brands.find((b) => b.requirementId === ids.reqA)?.status,
      ).toBe("ALREADY_SUCCEEDED");
      expect(
        retry.brands.find((b) => b.requirementId === ids.reqC)?.status,
      ).toBe("ALREADY_SUCCEEDED");

      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqA },
        }),
      ).toBe(reqACount);
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqC },
        }),
      ).toBe(reqCCount);
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqB },
        }),
      ).toBe(1);

      const ledgerB = await prisma.osfImportDistribution.findUniqueOrThrow({
        where: {
          osfImportId_requirementId: {
            osfImportId: ids.importId,
            requirementId: ids.reqB,
          },
        },
      });
      expect(ledgerB.status).toBe("SUCCEEDED");
      expect(Array.isArray(ledgerB.supplierRequestIds)).toBe(true);
      expect(
        (ledgerB.supplierRequestIds as string[]).length,
      ).toBeGreaterThan(0);

      // A/C requirement audits not duplicated; B gains exactly one on success.
      expect(await countRequirementAudits(ids.reqA)).toBe(auditABefore);
      expect(await countRequirementAudits(ids.reqC)).toBe(auditCBefore);
      expect(await countRequirementAudits(ids.reqB)).toBe(1);

      // Notifications: retry creates only for Brand B (one supplier user).
      const notifAfter = await prisma.notification.count({
        where: { userId: ids.supplierUser },
      });
      expect(notifAfter).toBe(notifBeforeRetry + 1);

      // Failed first attempt left zero Brand B requests/notifications.
      expect(reqBCountBefore).toBe(0);

      expect(
        await prisma.purchaseOrder.count({ where: { companyId: ids.company } }),
      ).toBe(0);

      const protectedPo = await prisma.purchaseOrder.findFirst({
        where: { orderNumber: "PO-20261112-E5D42983" },
        select: { status: true },
      });
      expect(protectedPo?.status).toBe("CONFIRMED");
    });

    it("recovers expired IN_PROGRESS claim and FAILED ledger retry", async () => {
      const past = new Date(Date.now() - 60_000);
      await prisma.osfImportDistribution.create({
        data: {
          companyId: ids.company,
          osfImportId: ids.importId,
          requirementId: ids.reqExpire,
          status: "IN_PROGRESS",
          claimToken: "stale-token",
          claimedById: ids.staff,
          claimedAt: past,
          claimExpiresAt: past,
          attemptCount: 1,
        },
      });

      const result = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        brands: [
          {
            requirementId: ids.reqExpire,
            mode: "ALL_MATCHING",
            supplierIds: [],
          },
        ],
      });
      expect(
        result.brands.find((b) => b.requirementId === ids.reqExpire)?.status,
      ).toBe("SUCCEEDED");

      const ledger = await prisma.osfImportDistribution.findUniqueOrThrow({
        where: {
          osfImportId_requirementId: {
            osfImportId: ids.importId,
            requirementId: ids.reqExpire,
          },
        },
      });
      expect(ledger.status).toBe("SUCCEEDED");
      expect(ledger.claimToken).toBeNull();
      expect(ledger.attemptCount).toBeGreaterThanOrEqual(2);
    });

    it("same-key concurrent double-submit: one winner, no duplicate requests", async () => {
      const key = randomUUID();
      const payload = {
        importId: ids.importId,
        idempotencyKey: key,
        brands: [
          {
            requirementId: ids.reqConc,
            mode: "ALL_MATCHING" as const,
            supplierIds: [],
          },
        ],
      };
      const settled = await Promise.allSettled([
        distributeOsfImport(payload),
        distributeOsfImport(payload),
      ]);

      const fulfilled = settled.filter((s) => s.status === "fulfilled");
      const rejected = settled.filter((s) => s.status === "rejected");
      expect(fulfilled.length + rejected.length).toBe(2);
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Loser is either IDEMPOTENCY_IN_PROGRESS or a replay of the winner.
      if (rejected.length) {
        const err = (rejected[0] as PromiseRejectedResult).reason as {
          code?: string;
        };
        expect(err.code).toBe("IDEMPOTENCY_IN_PROGRESS");
      } else {
        const results = fulfilled.map(
          (s) => (s as PromiseFulfilledResult<{ replay: boolean }>).value,
        );
        expect(results.some((r) => r.replay) || results.length === 2).toBe(
          true,
        );
      }

      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqConc },
        }),
      ).toBe(1);
    });

    it("timeout-after-commit: completed key replays; pending key does not re-send", async () => {
      // Simulate client timeout after brands committed + key completed: replay.
      const key = randomUUID();
      const first = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: key,
        brands: [
          {
            requirementId: ids.reqLock,
            mode: "ALL_MATCHING",
            supplierIds: [],
          },
        ],
      });
      expect(first.brands[0]?.status).toBe("SUCCEEDED");
      const requests = await prisma.supplierRequest.count({
        where: { requirementId: ids.reqLock },
      });
      const notifs = await prisma.notification.count({
        where: {
          userId: ids.supplierUser,
          entityType: "SupplierRequest",
          entityId: {
            in: (
              await prisma.supplierRequest.findMany({
                where: { requirementId: ids.reqLock },
                select: { id: true },
              })
            ).map((r) => r.id),
          },
        },
      });

      const replay = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: key,
        brands: [
          {
            requirementId: ids.reqLock,
            mode: "ALL_MATCHING",
            supplierIds: [],
          },
        ],
      });
      expect(replay.replay).toBe(true);
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqLock },
        }),
      ).toBe(requests);
      expect(
        await prisma.notification.count({
          where: {
            userId: ids.supplierUser,
            entityType: "SupplierRequest",
            entityId: {
              in: (
                await prisma.supplierRequest.findMany({
                  where: { requirementId: ids.reqLock },
                  select: { id: true },
                })
              ).map((r) => r.id),
            },
          },
        }),
      ).toBe(notifs);

      // Simulate stuck pending key after successful brand work: second same-key
      // submit must not create more requests (IN_PROGRESS or eventual replay).
      const stuckKey = randomUUID();
      const scope = osfImportDistributeIdempotencyScope(ids.staff);
      // Seed SUCCEEDED ledger + request already exist for reqLock — use a
      // synthetic pending key that matches a no-op ALREADY_SUCCEEDED payload.
      await prisma.idempotencyKey.create({
        data: {
          scope,
          key: stuckKey,
          expiresAt: new Date(Date.now() + 60_000),
          responseJson: {
            status: "pending",
            requestHash: (
              await import("./distribute")
            ).hashDistributeOsfImportRequest({
              importId: ids.importId,
              idempotencyKey: stuckKey,
              responseDeadline: undefined,
              acknowledgeOverQty: false,
              retryFailedOnly: false,
              brands: [
                {
                  requirementId: ids.reqLock,
                  mode: "ALL_MATCHING",
                  supplierIds: [],
                },
              ],
            }),
          },
        },
      });

      await expect(
        distributeOsfImport({
          importId: ids.importId,
          idempotencyKey: stuckKey,
          brands: [
            {
              requirementId: ids.reqLock,
              mode: "ALL_MATCHING",
              supplierIds: [],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });

      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: ids.reqLock },
        }),
      ).toBe(requests);
    });

    it("shared per-item override applies to every selected supplier; planned unchanged", async () => {
      // supplierAll (all brands) + supplierQty2 (brandQty) both match.
      const beforePlanned = await prisma.requirementItem.findUniqueOrThrow({
        where: { id: ids.itemQty },
      });
      expect(beforePlanned.quantityPlanned.toString()).toBe("6");

      await expect(
        distributeOsfImport({
          importId: ids.importId,
          idempotencyKey: randomUUID(),
          acknowledgeOverQty: false,
          brands: [
            {
              requirementId: ids.reqQty,
              mode: "SELECTED",
              supplierIds: [ids.supplierAll, ids.supplierQty2],
              quantityOverrides: [
                { requirementItemId: ids.itemQty, quantityRequested: 12 },
              ],
            },
          ],
        }).then((r) => r.brands[0]?.status),
      ).resolves.toBe("FAILED");

      const ok = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: true,
        retryFailedOnly: true,
        brands: [
          {
            requirementId: ids.reqQty,
            mode: "SELECTED",
            supplierIds: [ids.supplierAll, ids.supplierQty2],
            quantityOverrides: [
              { requirementItemId: ids.itemQty, quantityRequested: 12 },
            ],
          },
        ],
      });
      expect(ok.brands.find((b) => b.requirementId === ids.reqQty)?.status).toBe(
        "SUCCEEDED",
      );

      const items = await prisma.requestItem.findMany({
        where: { requirementItemId: ids.itemQty },
      });
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.quantityRequested.toString() === "12")).toBe(
        true,
      );

      const planned = await prisma.requirementItem.findUniqueOrThrow({
        where: { id: ids.itemQty },
      });
      expect(planned.quantityPlanned.toString()).toBe("6");
    });

    it("manual distributeRequirement regression unchanged", async () => {
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
      const item = await prisma.requestItem.findFirst({
        where: { requirementItemId: soloItem },
      });
      expect(item?.quantityRequested.toString()).toBe("7");
    });

    it("failed brand attempt leaves no supplier notifications for that brand", async () => {
      const brandFail = `${tag}_brf`;
      const productFail = `${tag}_prf`;
      const reqFail = `${tag}_rqf`;
      const itemFail = `${tag}_itf`;
      await prisma.brand.create({
        data: { id: brandFail, companyId: ids.company, name: `Fail ${tag}` },
      });
      await prisma.product.create({
        data: {
          id: productFail,
          companyId: ids.company,
          brandId: brandFail,
          name: "Fail",
          sku: `${tag}-F`,
          isActive: true,
        },
      });
      await prisma.requirement.create({
        data: {
          id: reqFail,
          companyId: ids.company,
          brandId: brandFail,
          osfImportId: ids.importId,
          status: "CONFIRMED",
          title: `Fail ${tag}`,
        },
      });
      await prisma.requirementItem.create({
        data: {
          id: itemFail,
          requirementId: reqFail,
          productId: productFail,
          quantityPlanned: 1,
        },
      });

      const notifBefore = await prisma.notification.count({
        where: { userId: ids.supplierUser },
      });
      const failed = await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        acknowledgeOverQty: false,
        brands: [
          {
            requirementId: reqFail,
            mode: "ALL_MATCHING",
            supplierIds: [],
            quantityOverrides: [
              { requirementItemId: itemFail, quantityRequested: 50 },
            ],
          },
        ],
      });
      expect(failed.brands[0]?.status).toBe("FAILED");
      expect(
        await prisma.supplierRequest.count({
          where: { requirementId: reqFail },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({ where: { userId: ids.supplierUser } }),
      ).toBe(notifBefore);
      expect(await countRequirementAudits(reqFail)).toBe(0);
    });

    it("documents import-level audit once per wizard submit (retry adds a new summary)", async () => {
      // First partial+retry test already created import audits; ensure count grows
      // by one on a no-op ALREADY_SUCCEEDED submit (summary audit, not brand audits).
      const before = await countImportDistributeAudits();
      const beforeReqA = await countRequirementAudits(ids.reqA);
      await distributeOsfImport({
        importId: ids.importId,
        idempotencyKey: randomUUID(),
        brands: [
          { requirementId: ids.reqA, mode: "ALL_MATCHING", supplierIds: [] },
        ],
      });
      expect(await countImportDistributeAudits()).toBe(before + 1);
      expect(await countRequirementAudits(ids.reqA)).toBe(beforeReqA);
    });
  },
);
