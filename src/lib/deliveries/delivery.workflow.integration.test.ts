/**
 * Neon development delivery workflow test.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 * Uses isolated fixtures only — never touches protected production-like POs.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("delivery workflow (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let submitDeliveryForUser: typeof import("./submit").submitDeliveryForUser;
  let verifyDeliveryForUser: typeof import("./verify").verifyDeliveryForUser;
  let rejectDeliveryForUser: typeof import("./verify").rejectDeliveryForUser;

  const tag = `dlv_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    supplier: `${tag}_su`,
    supplierUser: `${tag}_suu`,
    staff: `${tag}_st`,
    otherSupplier: `${tag}_os`,
    otherUser: `${tag}_ou`,
    po: `${tag}_po`,
    item: `${tag}_oi`,
  };

  const supplierUser = {
    id: ids.supplierUser,
    companyId: ids.company,
    supplierId: ids.supplier,
    role: "SUPPLIER" as const,
    email: `${tag}_sup@example.com`,
    isActive: true,
  };

  const staffUser = {
    id: ids.staff,
    companyId: ids.company,
    supplierId: null,
    role: "STAFF" as const,
    email: `${tag}_staff@example.com`,
    isActive: true,
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ submitDeliveryForUser } = await import("./submit"));
    ({ verifyDeliveryForUser, rejectDeliveryForUser } = await import("./verify"));

    const now = new Date();
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
        sku: `SKU-${tag}`,
        masterStatus: "PROVISIONAL",
        priorityStatus: "NORMAL",
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
    await prisma.supplier.create({
      data: {
        id: ids.otherSupplier,
        companyId: ids.company,
        name: `Other ${tag}`,
        status: "ACTIVE",
        supportsAllBrands: true,
        registrationSource: "ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        id: ids.supplierUser,
        companyId: ids.company,
        supplierId: ids.supplier,
        email: supplierUser.email,
        role: "SUPPLIER",
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: ids.otherUser,
        companyId: ids.company,
        supplierId: ids.otherSupplier,
        email: `${tag}_other@example.com`,
        role: "SUPPLIER",
        isActive: true,
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
    await prisma.staffPermission.createMany({
      data: [
        {
          id: `${tag}_perm_v`,
          userId: ids.staff,
          code: "VERIFY_DELIVERY",
        },
        {
          id: `${tag}_perm_g`,
          userId: ids.staff,
          code: "ISSUE_GRN",
        },
      ],
    });
    await prisma.purchaseOrder.create({
      data: {
        id: ids.po,
        companyId: ids.company,
        supplierId: ids.supplier,
        status: "CONFIRMED",
        orderNumber: `PO-TEST-${tag}`,
        confirmedAt: now,
        currencyCode: "LKR",
      },
    });
    await prisma.orderItem.create({
      data: {
        id: ids.item,
        purchaseOrderId: ids.po,
        companyId: ids.company,
        supplierId: ids.supplier,
        productId: ids.product,
        status: "ACTIVE",
        quantityOrdered: new Prisma.Decimal(10),
        quantityCancelled: new Prisma.Decimal(0),
        quantityVerifiedReceived: new Prisma.Decimal(0),
        unitPrice: new Prisma.Decimal("90.00"),
        originalExpectedDeliveryAt: now,
      },
    });
  });

  afterAll(async () => {
    await prisma.grnItem.deleteMany({
      where: { grn: { delivery: { purchaseOrderId: ids.po } } },
    });
    await prisma.grn.deleteMany({
      where: { delivery: { purchaseOrderId: ids.po } },
    });
    await prisma.deliveryItem.deleteMany({
      where: { delivery: { purchaseOrderId: ids.po } },
    });
    await prisma.delivery.deleteMany({ where: { purchaseOrderId: ids.po } });
    await prisma.orderItem.deleteMany({ where: { purchaseOrderId: ids.po } });
    await prisma.purchaseOrder.deleteMany({ where: { id: ids.po } });
    await prisma.staffPermission.deleteMany({ where: { userId: ids.staff } });
    await prisma.notification.deleteMany({
      where: { userId: { in: [ids.staff, ids.supplierUser, ids.otherUser] } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: [ids.staff, ids.supplierUser] } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: {
        OR: [
          { scope: { contains: ids.supplierUser } },
          { scope: { contains: ids.staff } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.supplierUser, ids.staff, ids.otherUser] } },
    });
    await prisma.supplier.deleteMany({
      where: { id: { in: [ids.supplier, ids.otherSupplier] } },
    });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  });

  it(
    "supports partial + multiple submissions, verification, discrepancy, and isolation",
    async () => {
    const unitPriceBefore = (
      await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.item } })
    ).unitPrice;

    const firstKey = randomUUID();
    const first = await submitDeliveryForUser(supplierUser as never, {
      idempotencyKey: firstKey,
      purchaseOrderId: ids.po,
      deliveredAt: "2026-11-10",
      confirmed: true,
      lines: [{ orderItemId: ids.item, quantity: "4" }],
    });
    expect(first.status).toBe("SUBMITTED");

    // Idempotent replay
    const replay = await submitDeliveryForUser(supplierUser as never, {
      idempotencyKey: firstKey,
      purchaseOrderId: ids.po,
      deliveredAt: "2026-11-10",
      confirmed: true,
      lines: [{ orderItemId: ids.item, quantity: "4" }],
    });
    expect(replay.deliveryId).toBe(first.deliveryId);

    // Over-delivery blocked while first hold is pending
    await expect(
      submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-10",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "7" }],
      }),
    ).rejects.toMatchObject({ code: "OVER_DELIVERY" });

    // Cross-supplier isolation
    await expect(
      submitDeliveryForUser(
        {
          ...supplierUser,
          id: ids.otherUser,
          supplierId: ids.otherSupplier,
        } as never,
        {
          idempotencyKey: randomUUID(),
          purchaseOrderId: ids.po,
          deliveredAt: "2026-11-10",
          confirmed: true,
          lines: [{ orderItemId: ids.item, quantity: "1" }],
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { id: first.deliveryId },
      include: { items: true },
    });
    expect(delivery.items[0]?.quantityDelivered.toString()).toBe("4");

    // Partial verification with discrepancy notes
    const verified = await verifyDeliveryForUser(staffUser as never, {
      idempotencyKey: randomUUID(),
      deliveryId: first.deliveryId,
      discrepancyNotes: "Received 3 of 4",
      lines: [
        {
          deliveryItemId: delivery.items[0]!.id,
          quantityReceived: "3",
        },
      ],
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.hasDiscrepancy).toBe(true);
    expect(verified.grnId).toBeTruthy();

    const itemAfter = await prisma.orderItem.findUniqueOrThrow({
      where: { id: ids.item },
    });
    expect(itemAfter.quantityVerifiedReceived.toString()).toBe("3");
    expect(itemAfter.unitPrice?.equals(unitPriceBefore!)).toBe(true);

    const poAfter = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: ids.po },
    });
    expect(poAfter.status).toBe("PARTIALLY_DELIVERED");

    // Second partial delivery
    const second = await submitDeliveryForUser(supplierUser as never, {
      idempotencyKey: randomUUID(),
      purchaseOrderId: ids.po,
      deliveredAt: "2026-11-11",
      confirmed: true,
      lines: [{ orderItemId: ids.item, quantity: "7" }],
    });

    // Reject / flag discrepancy releases hold
    await rejectDeliveryForUser(staffUser as never, {
      idempotencyKey: randomUUID(),
      deliveryId: second.deliveryId,
      discrepancyNotes: "Wrong batch — please resubmit",
    });

    const rejected = await prisma.delivery.findUniqueOrThrow({
      where: { id: second.deliveryId },
    });
    expect(rejected.status).toBe("REJECTED");

    // Resubmit remaining after reject
    const third = await submitDeliveryForUser(supplierUser as never, {
      idempotencyKey: randomUUID(),
      purchaseOrderId: ids.po,
      deliveredAt: "2026-11-12",
      confirmed: true,
      lines: [{ orderItemId: ids.item, quantity: "7" }],
    });
    const thirdItems = await prisma.deliveryItem.findMany({
      where: { deliveryId: third.deliveryId },
    });
    const full = await verifyDeliveryForUser(staffUser as never, {
      idempotencyKey: randomUUID(),
      deliveryId: third.deliveryId,
      lines: [
        {
          deliveryItemId: thirdItems[0]!.id,
          quantityReceived: "7",
        },
      ],
    });
    expect(full.hasDiscrepancy).toBe(false);

    const finalItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: ids.item },
    });
    expect(finalItem.quantityVerifiedReceived.toString()).toBe("10");
    expect(finalItem.status).toBe("FULFILLED");
    expect(finalItem.unitPrice?.equals(unitPriceBefore!)).toBe(true);

    const finalPo = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: ids.po },
    });
    expect(finalPo.status).toBe("DELIVERED");

    const audits = await prisma.auditLog.findMany({
      where: {
        entityType: "Delivery",
        entityId: { in: [first.deliveryId, second.deliveryId, third.deliveryId] },
      },
    });
    expect(audits.some((a) => a.action === "DELIVERY_SUBMITTED")).toBe(true);
    expect(audits.some((a) => a.action === "DELIVERY_VERIFIED")).toBe(true);
    expect(audits.some((a) => a.action === "DELIVERY_DISCREPANCY_FLAGGED")).toBe(
      true,
    );

    const staffNotes = await prisma.notification.findMany({
      where: { userId: ids.staff, entityType: "Delivery" },
    });
    expect(staffNotes.length).toBeGreaterThan(0);

    const supplierNotes = await prisma.notification.findMany({
      where: { userId: ids.supplierUser, entityType: "Delivery" },
    });
    expect(supplierNotes.length).toBeGreaterThan(0);
  },
    60_000,
  );
});
