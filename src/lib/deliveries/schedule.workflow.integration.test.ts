/**
 * Schedule → partial verify → reschedule remaining (Neon development).
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("schedule delivery workflow (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let scheduleDeliveryForUser: typeof import("./schedule").scheduleDeliveryForUser;
  let verifyDeliveryForUser: typeof import("./verify").verifyDeliveryForUser;

  const tag = `sdw_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    supplier: `${tag}_su`,
    supplierUser: `${tag}_suu`,
    staff: `${tag}_st`,
    po: `${tag}_po`,
    item: `${tag}_oi`,
  };

  const supplierUser = {
    id: ids.supplierUser,
    companyId: ids.company,
    supplierId: ids.supplier,
    role: "SUPPLIER" as const,
    email: `${tag}@example.com`,
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
    ({ scheduleDeliveryForUser } = await import("./schedule"));
    ({ verifyDeliveryForUser } = await import("./verify"));

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
        id: ids.staff,
        companyId: ids.company,
        email: staffUser.email,
        role: "STAFF",
        isActive: true,
      },
    });
    await prisma.staffPermission.createMany({
      data: [
        { id: `${tag}_pv`, userId: ids.staff, code: "VERIFY_DELIVERY" },
        { id: `${tag}_pg`, userId: ids.staff, code: "ISSUE_GRN" },
      ],
    });
    await prisma.purchaseOrder.create({
      data: {
        id: ids.po,
        companyId: ids.company,
        supplierId: ids.supplier,
        status: "CONFIRMED",
        orderNumber: `PO-SDW-${tag}`,
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
        unitPrice: new Prisma.Decimal("40.00"),
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
      where: { userId: { in: [ids.staff, ids.supplierUser] } },
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
      where: { id: { in: [ids.supplierUser, ids.staff] } },
    });
    await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  });

  it(
    "schedules 10, verifies 6, schedules remaining 4, verifies final 4",
    async () => {
      const priceBefore = (
        await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.item } })
      ).unitPrice;

      const first = await scheduleDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        plannedDeliveryAt: "2099-06-01",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "10" }],
      });
      expect(first.status).toBe("SCHEDULED");

      const scheduled = await prisma.delivery.findUniqueOrThrow({
        where: { id: first.deliveryId },
        include: { items: true, grn: true },
      });
      expect(scheduled.status).toBe("SCHEDULED");
      expect(scheduled.grn).toBeNull();
      expect(
        (
          await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.item } })
        ).quantityVerifiedReceived.toString(),
      ).toBe("0");

      const deliveryItems = scheduled.items;
      await verifyDeliveryForUser(staffUser as never, {
        idempotencyKey: randomUUID(),
        deliveryId: first.deliveryId,
        receivedAt: "2026-11-10",
        lines: [
          {
            deliveryItemId: deliveryItems[0]!.id,
            quantityReceived: "6",
          },
        ],
        discrepancyNotes: "Short shipment — 6 of 10 arrived",
      });

      const afterPartial = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(afterPartial.quantityVerifiedReceived.toString()).toBe("6");
      expect(afterPartial.unitPrice?.equals(priceBefore!)).toBe(true);

      const poPartial = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: ids.po },
      });
      expect(poPartial.status).toBe("PARTIALLY_DELIVERED");

      const second = await scheduleDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        plannedDeliveryAt: "2099-06-15",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "4" }],
      });
      expect(second.deliveryId).not.toBe(first.deliveryId);

      const secondItems = await prisma.deliveryItem.findMany({
        where: { deliveryId: second.deliveryId },
      });
      await verifyDeliveryForUser(staffUser as never, {
        idempotencyKey: randomUUID(),
        deliveryId: second.deliveryId,
        receivedAt: "2026-11-12",
        lines: [
          {
            deliveryItemId: secondItems[0]!.id,
            quantityReceived: "4",
          },
        ],
      });

      const finalItem = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(finalItem.quantityVerifiedReceived.toString()).toBe("10");
      expect(finalItem.unitPrice?.equals(priceBefore!)).toBe(true);

      const finalPo = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: ids.po },
      });
      expect(finalPo.status).toBe("DELIVERED");

      const grnCount = await prisma.grn.count({
        where: { delivery: { purchaseOrderId: ids.po } },
      });
      expect(grnCount).toBe(2);
    },
    90_000,
  );
});
