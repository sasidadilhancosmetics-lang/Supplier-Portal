/**
 * Cleanup-safe Price Negotiation end-to-end workflow on Neon development.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: ".env.local" });

vi.mock("server-only", () => ({}));

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("price negotiation workflow (Neon UAT)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let allocatePurchaseOrderForUser: typeof import("@/lib/orders/allocate").allocatePurchaseOrderForUser;
  let submitAvailabilitySchema: typeof import("@/lib/requests/schema").submitAvailabilitySchema;
  let isOrderDomainError: typeof import("@/lib/orders/errors").isOrderDomainError;

  const tag = `pn_uat_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    requirement: `${tag}_rq`,
    requirementItem: `${tag}_ri`,
    supplier: `${tag}_su`,
    supplier2: `${tag}_su2`,
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
    name: "PN Staff",
    isActive: true,
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ allocatePurchaseOrderForUser } = await import("@/lib/orders/allocate"));
    ({ submitAvailabilitySchema } = await import("@/lib/requests/schema"));
    ({ isOrderDomainError } = await import("@/lib/orders/errors"));

    const now = new Date();
    const reserveExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.company.create({
      data: { id: ids.company, name: `PN UAT ${tag}` },
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
        name: "PN Staff",
      },
    });
    await prisma.staffPermission.createMany({
      data: [
        {
          id: `${tag}_perm_alloc`,
          userId: ids.staff,
          code: "ALLOCATE_ORDER",
        },
        {
          id: `${tag}_perm_send`,
          userId: ids.staff,
          code: "SEND_SUPPLIER_REQUEST",
        },
      ],
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
    await prisma.supplier.create({
      data: {
        id: ids.supplier2,
        companyId: ids.company,
        name: `Supplier2 ${tag}`,
        status: "ACTIVE",
        supportsAllBrands: true,
        registrationSource: "ADMIN",
      },
    });
    await prisma.supplierBrand.create({
      data: { supplierId: ids.supplier, brandId: ids.brand },
    });
    await prisma.user.create({
      data: {
        id: ids.supplierUser,
        companyId: ids.company,
        supplierId: ids.supplier,
        email: `${tag}-sup@example.com`,
        role: "SUPPLIER",
        isActive: true,
        name: "PN Supplier",
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
        quantityPlanned: new Prisma.Decimal(50),
      },
    });
    await prisma.supplierRequest.create({
      data: {
        id: ids.request,
        companyId: ids.company,
        requirementId: ids.requirement,
        supplierId: ids.supplier,
        brandId: ids.brand,
        status: "NEW",
        sentAt: now,
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
        quantityRequested: new Prisma.Decimal(50),
      },
    });
    await prisma.availabilityOffer.create({
      data: {
        id: ids.offer,
        requestItemId: ids.item,
        supplierId: ids.supplier,
        status: "SUBMITTED",
        quantityDeclared: new Prisma.Decimal(40),
        quantityOrderedActive: new Prisma.Decimal(0),
        unitPrice: new Prisma.Decimal(125.5),
        currencyCode: "LKR",
        availableDate: new Date(Date.UTC(2026, 11, 1)),
        reservedAt: now,
        reserveExpiresAt: reserveExpires,
        submittedAt: now,
        version: 1,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.orderItem.deleteMany({ where: { companyId: ids.company } });
    await prisma.purchaseOrder.deleteMany({ where: { companyId: ids.company } });
    await prisma.priceAgreement.deleteMany({ where: { companyId: ids.company } });
    await prisma.priceQuote.deleteMany({ where: { companyId: ids.company } });
    await prisma.availabilityChange.deleteMany({
      where: { availabilityOfferId: ids.offer },
    });
    await prisma.availabilityOffer.deleteMany({ where: { id: ids.offer } });
    await prisma.requestItem.deleteMany({ where: { companyId: ids.company } });
    await prisma.supplierRequest.deleteMany({
      where: { companyId: ids.company },
    });
    await prisma.requirementItem.deleteMany({
      where: { requirementId: ids.requirement },
    });
    await prisma.requirement.deleteMany({ where: { id: ids.requirement } });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { contains: ids.staff } },
    });
    await prisma.notification.deleteMany({ where: { userId: ids.staff } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorUserId: ids.staff }, { actorUserId: ids.supplierUser }],
      },
    });
    await prisma.staffPermission.deleteMany({ where: { userId: ids.staff } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.staff, ids.supplierUser] } },
    });
    await prisma.supplierBrand.deleteMany({
      where: { supplierId: { in: [ids.supplier, ids.supplier2] } },
    });
    await prisma.supplier.deleteMany({
      where: { id: { in: [ids.supplier, ids.supplier2] } },
    });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  }, 60_000);

  it("keeps protected PO CONFIRMED v2", async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true, version: true },
    });
    expect(po?.status).toBe("CONFIRMED");
    expect(po?.version).toBe(2);
  });

  it("rejects missing/zero price and allows Not Available without price", () => {
    expect(
      submitAvailabilitySchema.safeParse({
        supplierRequestId: ids.request,
        lines: [
          {
            requestItemId: ids.item,
            quantityDeclared: "10",
            availableDate: "2026-12-01",
            notAvailable: false,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      submitAvailabilitySchema.safeParse({
        supplierRequestId: ids.request,
        lines: [
          {
            requestItemId: ids.item,
            quantityDeclared: "10",
            unitPrice: "0",
            availableDate: "2026-12-01",
            notAvailable: false,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      submitAvailabilitySchema.safeParse({
        supplierRequestId: ids.request,
        lines: [{ requestItemId: ids.item, notAvailable: true }],
      }).success,
    ).toBe(true);
  });

  it("saves original quote, portal negotiation history, phone attest, and PO snapshot", async () => {
    const now = new Date();
    const quoteId = `${ids.offer}_pq_orig`;
    await prisma.priceQuote.create({
      data: {
        id: quoteId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "PORTAL",
        kind: "SUPPLIER_ORIGINAL",
        status: "QUOTED",
        unitPrice: new Prisma.Decimal(125.5),
        currencyCode: "LKR",
        recordedByUserId: ids.supplierUser,
      },
    });
    await prisma.priceAgreement.create({
      data: {
        id: `${ids.offer}_pa`,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        status: "QUOTED",
        currentQuoteId: quoteId,
        unitPrice: new Prisma.Decimal(125.5),
        currencyCode: "LKR",
        channel: "PORTAL",
        version: 1,
      },
    });

    const orig = await prisma.priceQuote.findUnique({ where: { id: quoteId } });
    expect(orig?.kind).toBe("SUPPLIER_ORIGINAL");
    expect(Number(orig?.unitPrice)).toBe(125.5);

    await prisma.priceQuote.create({
      data: {
        id: `${tag}_pq_other`,
        companyId: ids.company,
        supplierId: ids.supplier2,
        productId: ids.product,
        channel: "PORTAL",
        kind: "SUPPLIER_ORIGINAL",
        status: "QUOTED",
        unitPrice: new Prisma.Decimal(110),
        currencyCode: "LKR",
      },
    });
    const oldPoId = `${tag}_po_hist`;
    await prisma.purchaseOrder.create({
      data: {
        id: oldPoId,
        companyId: ids.company,
        supplierId: ids.supplier2,
        status: "CONFIRMED",
        orderNumber: `PO-UAT-${tag}`,
        confirmedAt: now,
        currencyCode: "LKR",
      },
    });
    await prisma.orderItem.create({
      data: {
        id: `${tag}_oi_hist`,
        purchaseOrderId: oldPoId,
        companyId: ids.company,
        supplierId: ids.supplier2,
        productId: ids.product,
        status: "ACTIVE",
        quantityOrdered: new Prisma.Decimal(5),
        quantityCancelled: new Prisma.Decimal(0),
        quantityVerifiedReceived: new Prisma.Decimal(0),
        unitPrice: new Prisma.Decimal(99),
      },
    });

    const quotes = await prisma.priceQuote.findMany({
      where: { companyId: ids.company, productId: ids.product },
    });
    const purchased = await prisma.orderItem.findMany({
      where: {
        companyId: ids.company,
        productId: ids.product,
        unitPrice: { not: null },
        purchaseOrder: { status: "CONFIRMED" },
      },
    });
    expect(quotes.length).toBeGreaterThanOrEqual(2);
    expect(purchased.length).toBeGreaterThanOrEqual(1);

    const counterId = `${ids.offer}_pq_counter`;
    await prisma.priceQuote.update({
      where: { id: quoteId },
      data: { status: "SUPERSEDED" },
    });
    await prisma.priceQuote.create({
      data: {
        id: counterId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "PORTAL",
        kind: "COMPANY_COUNTER",
        status: "COUNTER_PENDING",
        unitPrice: new Prisma.Decimal(120),
        currencyCode: "LKR",
        recordedByUserId: ids.staff,
        supersedesQuoteId: quoteId,
      },
    });
    await prisma.priceAgreement.update({
      where: { availabilityOfferId: ids.offer },
      data: {
        status: "COUNTER_PENDING",
        currentQuoteId: counterId,
        unitPrice: new Prisma.Decimal(120),
        version: { increment: 1 },
      },
    });

    const stale = await prisma.priceAgreement.updateMany({
      where: { availabilityOfferId: ids.offer, version: 999 },
      data: { version: { increment: 1 } },
    });
    expect(stale.count).toBe(0);

    const acceptId = `${ids.offer}_pq_accept`;
    await prisma.priceQuote.update({
      where: { id: counterId },
      data: { status: "SUPERSEDED" },
    });
    await prisma.priceQuote.create({
      data: {
        id: acceptId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "PORTAL",
        kind: "SUPPLIER_ACCEPTANCE",
        status: "SUPPLIER_CONFIRMED",
        unitPrice: new Prisma.Decimal(120),
        currencyCode: "LKR",
        recordedByUserId: ids.supplierUser,
        supersedesQuoteId: counterId,
      },
    });
    await prisma.priceAgreement.update({
      where: { availabilityOfferId: ids.offer },
      data: {
        status: "SUPPLIER_CONFIRMED",
        currentQuoteId: acceptId,
        unitPrice: new Prisma.Decimal(120),
        version: { increment: 1 },
      },
    });

    const hist = await prisma.priceQuote.findMany({
      where: { availabilityOfferId: ids.offer },
      orderBy: { createdAt: "asc" },
    });
    expect(hist).toHaveLength(3);
    expect(hist.filter((h) => h.status === "SUPERSEDED")).toHaveLength(2);
    expect(hist.at(-1)?.status).toBe("SUPPLIER_CONFIRMED");

    const extId = `${ids.offer}_pq_ext`;
    await prisma.priceQuote.update({
      where: { id: acceptId },
      data: { status: "SUPERSEDED" },
    });
    await prisma.priceQuote.create({
      data: {
        id: extId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "WHATSAPP",
        kind: "STAFF_RECORDED_EXTERNAL",
        status: "STAFF_RECORDED_UNCONFIRMED",
        unitPrice: new Prisma.Decimal(118),
        currencyCode: "LKR",
        negotiationOccurredAt: now,
        recordedByUserId: ids.staff,
        notes: "WhatsApp chat",
        supersedesQuoteId: acceptId,
      },
    });
    await prisma.priceAgreement.update({
      where: { availabilityOfferId: ids.offer },
      data: {
        status: "STAFF_RECORDED_UNCONFIRMED",
        currentQuoteId: extId,
        unitPrice: new Prisma.Decimal(118),
        channel: "WHATSAPP",
        version: { increment: 1 },
      },
    });

    await expect(
      allocatePurchaseOrderForUser(staffUser, {
        idempotencyKey: randomUUID(),
        supplierId: ids.supplier,
        lines: [{ availabilityOfferId: ids.offer, quantity: "5" }],
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isOrderDomainError(error) && /not agreed|Negotiate/i.test(error.message),
    );

    const attestId = `${ids.offer}_pq_attest`;
    await prisma.priceQuote.update({
      where: { id: extId },
      data: { status: "SUPERSEDED" },
    });
    await prisma.priceQuote.create({
      data: {
        id: attestId,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        availabilityOfferId: ids.offer,
        requestItemId: ids.item,
        supplierRequestId: ids.request,
        channel: "WHATSAPP",
        kind: "STAFF_RECORDED_EXTERNAL",
        status: "STAFF_ATTESTED_AGREED",
        unitPrice: new Prisma.Decimal(118),
        currencyCode: "LKR",
        attestationStatement: "I confirm the supplier agreed on WhatsApp.",
        evidenceNote: "Chat screenshot timestamp 09:00",
        attestedAt: now,
        attestedByUserId: ids.staff,
        recordedByUserId: ids.staff,
        negotiationOccurredAt: now,
        supersedesQuoteId: extId,
      },
    });
    await prisma.priceAgreement.update({
      where: { availabilityOfferId: ids.offer },
      data: {
        status: "STAFF_ATTESTED_AGREED",
        currentQuoteId: attestId,
        unitPrice: new Prisma.Decimal(118),
        version: { increment: 1 },
      },
    });

    const allocated = await allocatePurchaseOrderForUser(staffUser, {
      idempotencyKey: randomUUID(),
      supplierId: ids.supplier,
      lines: [{ availabilityOfferId: ids.offer, quantity: "10" }],
    });
    const line = await prisma.orderItem.findFirst({
      where: { purchaseOrderId: allocated.purchaseOrderId },
    });
    expect(Number(line?.unitPrice)).toBe(118);
    expect(line?.priceQuoteId).toBe(attestId);
    expect(line?.priceAgreementStatusAtOrder).toBe("STAFF_ATTESTED_AGREED");

    const protectedAfter = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true, version: true },
    });
    expect(protectedAfter?.status).toBe("CONFIRMED");
    expect(protectedAfter?.version).toBe(2);
  }, 60_000);
});
