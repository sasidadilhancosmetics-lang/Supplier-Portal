/**
 * Multi-delivery idempotency against one PO (Neon development).
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 * Uses isolated fixtures only — does not touch protected POs.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("multi-delivery idempotency (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let submitDeliveryForUser: typeof import("./submit").submitDeliveryForUser;
  let verifyDeliveryForUser: typeof import("./verify").verifyDeliveryForUser;

  const tag = `mdi_${Date.now().toString(36)}`;
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
    ({ submitDeliveryForUser } = await import("./submit"));
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
        orderNumber: `PO-MDI-${tag}`,
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
        unitPrice: new Prisma.Decimal("55.00"),
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
    "first 6 then verify then second 4 with new key; replay and mismatch behave correctly",
    async () => {
      const priceBefore = (
        await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.item } })
      ).unitPrice;

      const firstKey = randomUUID();
      const firstPayload = {
        idempotencyKey: firstKey,
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-10",
        confirmed: true as const,
        lines: [{ orderItemId: ids.item, quantity: "6" }],
      };

      const first = await submitDeliveryForUser(
        supplierUser as never,
        firstPayload,
      );
      expect(first.status).toBe("SUBMITTED");

      // Same-payload retry (double-click / network retry) — no duplicate
      const replay = await submitDeliveryForUser(
        supplierUser as never,
        firstPayload,
      );
      expect(replay.deliveryId).toBe(first.deliveryId);
      const deliveryCountAfterReplay = await prisma.delivery.count({
        where: { purchaseOrderId: ids.po },
      });
      expect(deliveryCountAfterReplay).toBe(1);

      // Same key, different payload — conflict
      await expect(
        submitDeliveryForUser(supplierUser as never, {
          ...firstPayload,
          lines: [{ orderItemId: ids.item, quantity: "4" }],
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });

      const deliveryItems = await prisma.deliveryItem.findMany({
        where: { deliveryId: first.deliveryId },
      });
      await verifyDeliveryForUser(staffUser as never, {
        idempotencyKey: randomUUID(),
        deliveryId: first.deliveryId,
        lines: [
          {
            deliveryItemId: deliveryItems[0]!.id,
            quantityReceived: "6",
          },
        ],
      });

      const afterVerify = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(afterVerify.quantityVerifiedReceived.toString()).toBe("6");
      expect(afterVerify.unitPrice?.equals(priceBefore!)).toBe(true);

      // Second delivery of remaining 4 — MUST use a new key (form rotation)
      const secondKey = randomUUID();
      expect(secondKey).not.toBe(firstKey);
      const second = await submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: secondKey,
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-11",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "4" }],
      });
      expect(second.deliveryId).not.toBe(first.deliveryId);

      const deliveries = await prisma.delivery.findMany({
        where: { purchaseOrderId: ids.po },
        orderBy: { createdAt: "asc" },
      });
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]?.idempotencyKey).toBe(firstKey);
      expect(deliveries[1]?.idempotencyKey).toBe(secondKey);

      const item = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(item.quantityVerifiedReceived.toString()).toBe("6");
      expect(item.unitPrice?.equals(priceBefore!)).toBe(true);

      const pendingHold = await prisma.deliveryItem.aggregate({
        where: {
          orderItemId: ids.item,
          delivery: { status: "SUBMITTED" },
        },
        _sum: { quantityDelivered: true },
      });
      expect(pendingHold._sum.quantityDelivered?.toString()).toBe("4");

      const grns = await prisma.grn.count({
        where: { deliveryId: first.deliveryId },
      });
      expect(grns).toBe(1);
    },
    90_000,
  );
});
