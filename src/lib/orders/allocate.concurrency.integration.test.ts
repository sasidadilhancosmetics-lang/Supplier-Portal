/**
 * Real Neon development concurrency test.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("allocate concurrency (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let allocatePurchaseOrderForUser: typeof import("./allocate").allocatePurchaseOrderForUser;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;

  const tag = `6a1_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    requirement: `${tag}_rq`,
    requirementItem: `${tag}_ri`,
    supplierA: `${tag}_sa`,
    supplierB: `${tag}_sb`,
    requestA: `${tag}_ra`,
    requestB: `${tag}_rb`,
    itemA: `${tag}_ia`,
    itemB: `${tag}_ib`,
    offerA: `${tag}_oa`,
    offerB: `${tag}_ob`,
    staff: `${tag}_st`,
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ allocatePurchaseOrderForUser } = await import("./allocate"));
    ({ Prisma } = await import("@/generated/prisma/client"));

    const now = new Date();
    const reserveExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.company.create({
      data: {
        id: ids.company,
        name: `Company ${tag}`,
      },
    });
    await prisma.brand.create({
      data: { id: ids.brand, companyId: ids.company, name: `Brand ${tag}` },
    });
    await prisma.product.create({
      data: {
        id: ids.product,
        companyId: ids.company,
        brandId: ids.brand,
        name: `Product ${tag}`,
        masterStatus: "PROVISIONAL",
        priorityStatus: "NORMAL",
      },
    });
    await prisma.user.create({
      data: {
        id: ids.staff,
        companyId: ids.company,
        email: `${tag}@example.com`,
        role: "STAFF",
        isActive: true,
      },
    });
    await prisma.staffPermission.create({
      data: {
        id: `${tag}_perm`,
        userId: ids.staff,
        code: "ALLOCATE_ORDER",
      },
    });

    for (const [sid, name] of [
      [ids.supplierA, "Supplier A"],
      [ids.supplierB, "Supplier B"],
    ] as const) {
      await prisma.supplier.create({
        data: {
          id: sid,
          companyId: ids.company,
          name: `${name} ${tag}`,
          status: "ACTIVE",
          supportsAllBrands: true,
          registrationSource: "ADMIN",
        },
      });
    }

    await prisma.requirement.create({
      data: {
        id: ids.requirement,
        companyId: ids.company,
        brandId: ids.brand,
        status: "CONFIRMED",
        title: `Req ${tag}`,
      },
    });
    await prisma.requirementItem.create({
      data: {
        id: ids.requirementItem,
        requirementId: ids.requirement,
        productId: ids.product,
        quantityPlanned: new Prisma.Decimal(100),
      },
    });

    for (const row of [
      {
        requestId: ids.requestA,
        supplierId: ids.supplierA,
        itemId: ids.itemA,
        offerId: ids.offerA,
      },
      {
        requestId: ids.requestB,
        supplierId: ids.supplierB,
        itemId: ids.itemB,
        offerId: ids.offerB,
      },
    ]) {
      await prisma.supplierRequest.create({
        data: {
          id: row.requestId,
          companyId: ids.company,
          requirementId: ids.requirement,
          supplierId: row.supplierId,
          brandId: ids.brand,
          status: "RESPONDED",
          sentAt: now,
          respondedAt: now,
        },
      });
      await prisma.requestItem.create({
        data: {
          id: row.itemId,
          supplierRequestId: row.requestId,
          companyId: ids.company,
          supplierId: row.supplierId,
          requirementItemId: ids.requirementItem,
          productId: ids.product,
          quantityRequested: new Prisma.Decimal(100),
        },
      });
      await prisma.availabilityOffer.create({
        data: {
          id: row.offerId,
          requestItemId: row.itemId,
          supplierId: row.supplierId,
          status: "SUBMITTED",
          quantityDeclared: new Prisma.Decimal(100),
          quantityOrderedActive: new Prisma.Decimal(0),
          unitPrice: new Prisma.Decimal(10),
          currencyCode: "LKR",
          availableDate: new Date(Date.UTC(2026, 6, 15)),
          reservedAt: now,
          reserveExpiresAt: reserveExpires,
          version: 1,
          submittedAt: now,
        },
      });
      const quoteId = `${row.offerId}_pq`;
      await prisma.priceQuote.create({
        data: {
          id: quoteId,
          companyId: ids.company,
          supplierId: row.supplierId,
          productId: ids.product,
          availabilityOfferId: row.offerId,
          requestItemId: row.itemId,
          supplierRequestId: row.requestId,
          channel: "PORTAL",
          kind: "SUPPLIER_ACCEPTANCE",
          status: "SUPPLIER_CONFIRMED",
          unitPrice: new Prisma.Decimal(10),
          currencyCode: "LKR",
        },
      });
      await prisma.priceAgreement.create({
        data: {
          id: `${row.offerId}_pa`,
          companyId: ids.company,
          supplierId: row.supplierId,
          productId: ids.product,
          availabilityOfferId: row.offerId,
          requestItemId: row.itemId,
          status: "SUPPLIER_CONFIRMED",
          currentQuoteId: quoteId,
          unitPrice: new Prisma.Decimal(10),
          currencyCode: "LKR",
          channel: "PORTAL",
          version: 1,
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    // Delete in FK-safe order for this fixture only.
    await prisma.orderItem.deleteMany({
      where: { companyId: ids.company },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { companyId: ids.company },
    });
    await prisma.priceAgreement.deleteMany({
      where: { availabilityOfferId: { in: [ids.offerA, ids.offerB] } },
    });
    await prisma.priceQuote.deleteMany({
      where: { availabilityOfferId: { in: [ids.offerA, ids.offerB] } },
    });
    await prisma.availabilityChange.deleteMany({
      where: {
        availabilityOfferId: { in: [ids.offerA, ids.offerB] },
      },
    });
    await prisma.availabilityOffer.deleteMany({
      where: { id: { in: [ids.offerA, ids.offerB] } },
    });
    await prisma.requestItem.deleteMany({
      where: { id: { in: [ids.itemA, ids.itemB] } },
    });
    await prisma.supplierRequest.deleteMany({
      where: { id: { in: [ids.requestA, ids.requestB] } },
    });
    await prisma.requirementItem.deleteMany({
      where: { id: ids.requirementItem },
    });
    await prisma.requirement.deleteMany({ where: { id: ids.requirement } });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { contains: ids.staff } },
    });
    await prisma.notification.deleteMany({
      where: { entityId: { startsWith: tag } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: ids.staff },
    });
    await prisma.staffPermission.deleteMany({ where: { userId: ids.staff } });
    await prisma.user.deleteMany({ where: { id: ids.staff } });
    await prisma.supplier.deleteMany({
      where: { id: { in: [ids.supplierA, ids.supplierB] } },
    });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  }, 60_000);

  it("prevents two concurrent allocations from exceeding remaining plan", async () => {
    const staff = {
      id: ids.staff,
      companyId: ids.company,
      role: "STAFF" as const,
      supplierId: null,
      email: `${tag}@example.com`,
      name: "Staff",
      isActive: true,
    };

    const results = await Promise.allSettled([
      allocatePurchaseOrderForUser(staff, {
        idempotencyKey: randomUUID(),
        supplierId: ids.supplierA,
        lines: [{ availabilityOfferId: ids.offerA, quantity: "100" }],
      }),
      allocatePurchaseOrderForUser(staff, {
        idempotencyKey: randomUUID(),
        supplierId: ids.supplierB,
        lines: [{ availabilityOfferId: ids.offerB, quantity: "100" }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Without above-plan ack, only one full-plan take can succeed.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const offers = await prisma.availabilityOffer.findMany({
      where: { id: { in: [ids.offerA, ids.offerB] } },
      select: { id: true, quantityOrderedActive: true },
    });
    const totalActive = offers.reduce(
      (acc, o) => acc.plus(o.quantityOrderedActive),
      new Prisma.Decimal(0),
    );
    expect(totalActive.toString()).toBe("100");

    const items = await prisma.orderItem.findMany({
      where: { companyId: ids.company },
      select: { quantityOrdered: true, quantityCancelled: true },
    });
    const net = items.reduce(
      (acc, i) => acc.plus(i.quantityOrdered.minus(i.quantityCancelled)),
      new Prisma.Decimal(0),
    );
    expect(net.toString()).toBe("100");
  }, 60_000);
});
