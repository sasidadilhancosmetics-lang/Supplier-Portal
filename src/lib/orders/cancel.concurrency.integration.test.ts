/**
 * Real Neon development concurrency tests for cancel / confirm races.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("cancel concurrency (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let allocatePurchaseOrderForUser: typeof import("./allocate").allocatePurchaseOrderForUser;
  let cancelPurchaseOrderForUser: typeof import("./cancel").cancelPurchaseOrderForUser;
  let confirmPurchaseOrderForUser: typeof import("./confirm").confirmPurchaseOrderForUser;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let isOrderDomainError: typeof import("./errors").isOrderDomainError;

  const tag = `6a3_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    requirement: `${tag}_rq`,
    requirementItem: `${tag}_ri`,
    supplier: `${tag}_su`,
    request: `${tag}_sr`,
    item: `${tag}_si`,
    offer: `${tag}_of`,
    staff: `${tag}_st`,
    supplierUser: `${tag}_suu`,
  };

  const staffUser = {
    id: ids.staff,
    companyId: ids.company,
    role: "STAFF" as const,
    supplierId: null as string | null,
    email: `${tag}-staff@example.com`,
    name: "Staff",
    isActive: true,
  };

  const supplierActor = {
    id: ids.supplierUser,
    companyId: ids.company,
    role: "SUPPLIER" as const,
    supplierId: ids.supplier,
    email: `${tag}-sup@example.com`,
    name: "Supplier",
    isActive: true,
  };

  async function ensureAgreedPrice(offerId: string) {
    const existing = await prisma.priceAgreement.findUnique({
      where: { availabilityOfferId: offerId },
    });
    if (existing?.status === "SUPPLIER_CONFIRMED") {
      return;
    }

    const quoteId = `${offerId}_pq_${randomUUID().slice(0, 8)}`;
    await prisma.priceQuote.create({
      data: {
        id: quoteId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: offerId,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "PORTAL",
        kind: "SUPPLIER_ACCEPTANCE",
        status: "SUPPLIER_CONFIRMED",
        unitPrice: new Prisma.Decimal(10),
        currencyCode: "LKR",
      },
    });
    if (existing) {
      await prisma.priceAgreement.update({
        where: { id: existing.id },
        data: {
          status: "SUPPLIER_CONFIRMED",
          currentQuoteId: quoteId,
          unitPrice: new Prisma.Decimal(10),
          currencyCode: "LKR",
          channel: "PORTAL",
          version: { increment: 1 },
        },
      });
      return;
    }
    await prisma.priceAgreement.create({
      data: {
        id: `${offerId}_pa`,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: offerId,
        requestItemId: ids.item,
        status: "SUPPLIER_CONFIRMED",
        currentQuoteId: quoteId,
        unitPrice: new Prisma.Decimal(10),
        currencyCode: "LKR",
        channel: "PORTAL",
        version: 1,
      },
    });
  }

  async function seedOfferAndAllocate(qty: string) {
    const now = new Date();
    const reserveExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.availabilityOffer.update({
      where: { id: ids.offer },
      data: {
        status: "SUBMITTED",
        quantityDeclared: new Prisma.Decimal(100),
        quantityOrderedActive: new Prisma.Decimal(0),
        unitPrice: new Prisma.Decimal(10),
        currencyCode: "LKR",
        reservedAt: now,
        reserveExpiresAt: reserveExpires,
        version: { increment: 1 },
      },
    });
    await ensureAgreedPrice(ids.offer);

    const allocated = await allocatePurchaseOrderForUser(staffUser, {
      idempotencyKey: randomUUID(),
      supplierId: ids.supplier,
      lines: [{ availabilityOfferId: ids.offer, quantity: qty }],
    });
    return allocated;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ allocatePurchaseOrderForUser } = await import("./allocate"));
    ({ cancelPurchaseOrderForUser } = await import("./cancel"));
    ({ confirmPurchaseOrderForUser } = await import("./confirm"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ isOrderDomainError } = await import("./errors"));

    const now = new Date();
    const reserveExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.company.create({
      data: { id: ids.company, name: `Company ${tag}` },
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
        email: staffUser.email,
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
    await prisma.supplier.create({
      data: {
        id: ids.supplier,
        companyId: ids.company,
        name: `Supplier ${tag}`,
        status: "ACTIVE",
        supportsAllBrands: true,
        registrationSource: "ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        id: ids.supplierUser,
        companyId: ids.company,
        email: supplierActor.email,
        role: "SUPPLIER",
        supplierId: ids.supplier,
        isActive: true,
      },
    });
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
    await prisma.supplierRequest.create({
      data: {
        id: ids.request,
        companyId: ids.company,
        requirementId: ids.requirement,
        supplierId: ids.supplier,
        brandId: ids.brand,
        status: "RESPONDED",
        sentAt: now,
        respondedAt: now,
      },
    });
    await prisma.requestItem.create({
      data: {
        id: ids.item,
        supplierRequestId: ids.request,
        companyId: ids.company,
        supplierId: ids.supplier,
        requirementItemId: ids.requirementItem,
        productId: ids.product,
        quantityRequested: new Prisma.Decimal(100),
      },
    });
    await prisma.availabilityOffer.create({
      data: {
        id: ids.offer,
        requestItemId: ids.item,
        supplierId: ids.supplier,
        status: "SUBMITTED",
        quantityDeclared: new Prisma.Decimal(100),
        quantityOrderedActive: new Prisma.Decimal(0),
        availableDate: new Date(Date.UTC(2026, 6, 15)),
        reservedAt: now,
        reserveExpiresAt: reserveExpires,
        version: 1,
        submittedAt: now,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.orderItem.deleteMany({ where: { companyId: ids.company } });
    await prisma.purchaseOrder.deleteMany({ where: { companyId: ids.company } });
    await prisma.notification.deleteMany({
      where: { userId: { in: [ids.staff, ids.supplierUser] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: ids.staff },
          { actorUserId: ids.supplierUser },
        ],
      },
    });
    await prisma.priceAgreement.deleteMany({
      where: { availabilityOfferId: ids.offer },
    });
    await prisma.priceQuote.deleteMany({
      where: { availabilityOfferId: ids.offer },
    });
    await prisma.availabilityChange.deleteMany({
      where: { availabilityOfferId: ids.offer },
    });
    await prisma.availabilityOffer.deleteMany({ where: { id: ids.offer } });
    await prisma.requestItem.deleteMany({ where: { id: ids.item } });
    await prisma.supplierRequest.deleteMany({ where: { id: ids.request } });
    await prisma.requirementItem.deleteMany({
      where: { id: ids.requirementItem },
    });
    await prisma.requirement.deleteMany({ where: { id: ids.requirement } });
    await prisma.idempotencyKey.deleteMany({
      where: {
        OR: [
          { scope: { contains: ids.staff } },
          { scope: { contains: ids.supplierUser } },
        ],
      },
    });
    await prisma.staffPermission.deleteMany({ where: { userId: ids.staff } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.staff, ids.supplierUser] } },
    });
    await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  }, 60_000);

  it("prevents concurrent duplicate cancellation from double-releasing", async () => {
    const allocated = await seedOfferAndAllocate("20");
    const reserveBefore = await prisma.availabilityOffer.findUniqueOrThrow({
      where: { id: ids.offer },
      select: {
        quantityOrderedActive: true,
        reserveExpiresAt: true,
        reservedAt: true,
        status: true,
      },
    });
    expect(reserveBefore.quantityOrderedActive.toString()).toBe("20");

    const reason = "Concurrent cancel test";
    const results = await Promise.allSettled([
      cancelPurchaseOrderForUser(supplierActor, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: allocated.purchaseOrderId,
        cancelReason: reason,
      }),
      cancelPurchaseOrderForUser(supplierActor, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: allocated.purchaseOrderId,
        cancelReason: reason,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const offer = await prisma.availabilityOffer.findUniqueOrThrow({
      where: { id: ids.offer },
    });
    expect(offer.quantityOrderedActive.toString()).toBe("0");
    expect(offer.reserveExpiresAt?.toISOString()).toBe(
      reserveBefore.reserveExpiresAt?.toISOString(),
    );
    expect(offer.reservedAt?.toISOString()).toBe(
      reserveBefore.reservedAt?.toISOString(),
    );

    const releases = await prisma.availabilityChange.count({
      where: {
        availabilityOfferId: ids.offer,
        changeType: "ORDER_ALLOCATION_RELEASED",
        reason,
      },
    });
    expect(releases).toBe(1);

    const coverage = await prisma.$queryRaw<Array<{ net: unknown }>>`
      SELECT COALESCE(SUM(oi."quantityOrdered" - oi."quantityCancelled"), 0) AS net
      FROM "RequestItem" ri
      INNER JOIN "AvailabilityOffer" ao ON ao."requestItemId" = ri.id
      INNER JOIN "OrderItem" oi ON oi."availabilityOfferId" = ao.id
      WHERE ri."requirementItemId" = ${ids.requirementItem}
    `;
    expect(Number(coverage[0]?.net ?? 0)).toBe(0);
  }, 90_000);

  it("serializes confirmation vs cancellation on SENT", async () => {
    const allocated = await seedOfferAndAllocate("15");

    const results = await Promise.allSettled([
      confirmPurchaseOrderForUser(supplierActor, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: allocated.purchaseOrderId,
      }),
      cancelPurchaseOrderForUser(supplierActor, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: allocated.purchaseOrderId,
        cancelReason: "Race cancel",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: allocated.purchaseOrderId },
    });

    // Valid end states: cancelled (cancel won first or after confirm), or confirmed then cancelled.
    // With parallel race, both can succeed if confirm then cancel; or only cancel; confirm alone cannot leave SENT.
    expect(["CONFIRMED", "CANCELLED"]).toContain(po.status);

    if (po.status === "CONFIRMED") {
      // Cancel must have been the loser
      const cancelRejected = results.find(
        (r) =>
          r.status === "rejected" &&
          isOrderDomainError(r.reason) &&
          (r.reason.code === "INVALID_STATUS" ||
            r.reason.code === "CONCURRENCY_CONFLICT"),
      );
      // If cancel also succeeded we'd be CANCELLED — so confirm-only means cancel failed.
      expect(cancelRejected || fulfilled.length === 1).toBeTruthy();
      expect(po.confirmedAt).not.toBeNull();
    }

    if (po.status === "CANCELLED") {
      expect(po.cancelledAt).not.toBeNull();
      const offer = await prisma.availabilityOffer.findUniqueOrThrow({
        where: { id: ids.offer },
      });
      expect(offer.quantityOrderedActive.toString()).toBe("0");
    }
  }, 90_000);
});
