/**
 * Neon development concurrent delivery submit test.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("delivery concurrency (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let submitDeliveryForUser: typeof import("./submit").submitDeliveryForUser;

  const tag = `dlc_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    supplier: `${tag}_su`,
    supplierUser: `${tag}_suu`,
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

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ submitDeliveryForUser } = await import("./submit"));

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
    await prisma.purchaseOrder.create({
      data: {
        id: ids.po,
        companyId: ids.company,
        supplierId: ids.supplier,
        status: "CONFIRMED",
        orderNumber: `PO-CONC-${tag}`,
        confirmedAt: now,
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
        unitPrice: new Prisma.Decimal("50.00"),
      },
    });
  });

  afterAll(async () => {
    await prisma.deliveryItem.deleteMany({
      where: { delivery: { purchaseOrderId: ids.po } },
    });
    await prisma.delivery.deleteMany({ where: { purchaseOrderId: ids.po } });
    await prisma.orderItem.deleteMany({ where: { purchaseOrderId: ids.po } });
    await prisma.purchaseOrder.deleteMany({ where: { id: ids.po } });
    await prisma.idempotencyKey.deleteMany({
      where: { scope: { contains: ids.supplierUser } },
    });
    await prisma.notification.deleteMany({ where: { userId: ids.supplierUser } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: ids.supplierUser } });
    await prisma.user.deleteMany({ where: { id: ids.supplierUser } });
    await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  });

  it("prevents concurrent submissions from exceeding remaining deliverable", async () => {
    const results = await Promise.allSettled([
      submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-10",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "7" }],
      }),
      submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-10",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "7" }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const holds = await prisma.deliveryItem.aggregate({
      where: {
        orderItemId: ids.item,
        delivery: { status: "SUBMITTED" },
      },
      _sum: { quantityDelivered: true },
    });
    expect(Number(holds._sum.quantityDelivered?.toString() ?? "0")).toBeLessThanOrEqual(
      10,
    );
  });
});
