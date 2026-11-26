/**
 * Neon concurrent verification + permission safety.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("delivery verification safety (Neon)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;
  let submitDeliveryForUser: typeof import("./submit").submitDeliveryForUser;
  let verifyDeliveryForUser: typeof import("./verify").verifyDeliveryForUser;
  let rejectDeliveryForUser: typeof import("./verify").rejectDeliveryForUser;
  let AuthorizationError: typeof import("@/lib/auth/errors").AuthorizationError;

  const tag = `dvf_${Date.now().toString(36)}`;
  const ids = {
    company: `${tag}_co`,
    brand: `${tag}_br`,
    product: `${tag}_pr`,
    supplier: `${tag}_su`,
    supplierUser: `${tag}_suu`,
    staffBoth: `${tag}_sb`,
    staffVerifyOnly: `${tag}_sv`,
    staffGrnOnly: `${tag}_sg`,
    admin: `${tag}_ad`,
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

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
    ({ submitDeliveryForUser } = await import("./submit"));
    ({ verifyDeliveryForUser, rejectDeliveryForUser } = await import("./verify"));
    ({ AuthorizationError } = await import("@/lib/auth/errors"));

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
    for (const [id, email, role] of [
      [ids.supplierUser, supplierUser.email, "SUPPLIER"],
      [ids.staffBoth, `${tag}_both@example.com`, "STAFF"],
      [ids.staffVerifyOnly, `${tag}_vonly@example.com`, "STAFF"],
      [ids.staffGrnOnly, `${tag}_gonly@example.com`, "STAFF"],
      [ids.admin, `${tag}_admin@example.com`, "ADMIN"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          companyId: ids.company,
          supplierId: role === "SUPPLIER" ? ids.supplier : null,
          email,
          role,
          isActive: true,
        },
      });
    }
    await prisma.staffPermission.createMany({
      data: [
        { id: `${tag}_p1`, userId: ids.staffBoth, code: "VERIFY_DELIVERY" },
        { id: `${tag}_p2`, userId: ids.staffBoth, code: "ISSUE_GRN" },
        { id: `${tag}_p3`, userId: ids.staffVerifyOnly, code: "VERIFY_DELIVERY" },
        { id: `${tag}_p4`, userId: ids.staffGrnOnly, code: "ISSUE_GRN" },
      ],
    });
    await prisma.purchaseOrder.create({
      data: {
        id: ids.po,
        companyId: ids.company,
        supplierId: ids.supplier,
        status: "CONFIRMED",
        orderNumber: `PO-VF-${tag}`,
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
        unitPrice: new Prisma.Decimal("77.50"),
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
    await prisma.staffPermission.deleteMany({
      where: {
        userId: {
          in: [ids.staffBoth, ids.staffVerifyOnly, ids.staffGrnOnly],
        },
      },
    });
    await prisma.notification.deleteMany({
      where: {
        userId: {
          in: [
            ids.supplierUser,
            ids.staffBoth,
            ids.staffVerifyOnly,
            ids.staffGrnOnly,
            ids.admin,
          ],
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        actorUserId: {
          in: [ids.supplierUser, ids.staffBoth, ids.admin],
        },
      },
    });
    await prisma.idempotencyKey.deleteMany({
      where: {
        OR: [
          { scope: { contains: ids.supplierUser } },
          { scope: { contains: ids.staffBoth } },
          { scope: { contains: ids.admin } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            ids.supplierUser,
            ids.staffBoth,
            ids.staffVerifyOnly,
            ids.staffGrnOnly,
            ids.admin,
          ],
        },
      },
    });
    await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.brand.deleteMany({ where: { id: ids.brand } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
  });

  it(
    "enforces dual permissions, concurrent verify, reject release, price immutability",
    async () => {
      const { assertStaffPermissions } = await import("@/lib/auth/authorize");
      const { loadStaffPermissionCodes } = await import(
        "@/lib/auth/permissions"
      );

      const verifyOnlyGrants = await loadStaffPermissionCodes(
        ids.staffVerifyOnly,
      );
      const grnOnlyGrants = await loadStaffPermissionCodes(ids.staffGrnOnly);
      const bothGrants = await loadStaffPermissionCodes(ids.staffBoth);

      expect(() =>
        assertStaffPermissions(
          {
            id: ids.staffVerifyOnly,
            companyId: ids.company,
            role: "STAFF",
            email: "",
            isActive: true,
            supplierId: null,
            name: null,
          },
          verifyOnlyGrants,
          ["VERIFY_DELIVERY", "ISSUE_GRN"],
        ),
      ).toThrow(AuthorizationError);

      expect(() =>
        assertStaffPermissions(
          {
            id: ids.staffGrnOnly,
            companyId: ids.company,
            role: "STAFF",
            email: "",
            isActive: true,
            supplierId: null,
            name: null,
          },
          grnOnlyGrants,
          ["VERIFY_DELIVERY", "ISSUE_GRN"],
        ),
      ).toThrow(AuthorizationError);

      expect(() =>
        assertStaffPermissions(
          {
            id: ids.staffBoth,
            companyId: ids.company,
            role: "STAFF",
            email: "",
            isActive: true,
            supplierId: null,
            name: null,
          },
          bothGrants,
          ["VERIFY_DELIVERY", "ISSUE_GRN"],
        ),
      ).not.toThrow();

      expect(() =>
        assertStaffPermissions(
          {
            id: ids.admin,
            companyId: ids.company,
            role: "ADMIN",
            email: "",
            isActive: true,
            supplierId: null,
            name: null,
          },
          new Set(),
          ["VERIFY_DELIVERY", "ISSUE_GRN"],
        ),
      ).not.toThrow();

      const submitted = await submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-10",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "4" }],
      });

      // Reject releases hold without counting received
      await rejectDeliveryForUser(
        {
          id: ids.staffBoth,
          companyId: ids.company,
          role: "STAFF",
          email: "",
          isActive: true,
          supplierId: null,
        } as never,
        {
          idempotencyKey: randomUUID(),
          deliveryId: submitted.deliveryId,
          discrepancyNotes: "Damaged on arrival — resubmit",
        },
      );

      const afterReject = await prisma.delivery.findUniqueOrThrow({
        where: { id: submitted.deliveryId },
      });
      expect(afterReject.status).toBe("REJECTED");
      const itemAfterReject = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(itemAfterReject.quantityVerifiedReceived.toString()).toBe("0");
      expect(itemAfterReject.unitPrice?.toString()).toBe("77.5");

      const again = await submitDeliveryForUser(supplierUser as never, {
        idempotencyKey: randomUUID(),
        purchaseOrderId: ids.po,
        deliveredAt: "2026-11-11",
        confirmed: true,
        lines: [{ orderItemId: ids.item, quantity: "6" }],
      });
      const items = await prisma.deliveryItem.findMany({
        where: { deliveryId: again.deliveryId },
      });

      const staffBoth = {
        id: ids.staffBoth,
        companyId: ids.company,
        role: "STAFF" as const,
        email: `${tag}_both@example.com`,
        isActive: true,
        supplierId: null,
      };
      const adminUser = {
        id: ids.admin,
        companyId: ids.company,
        role: "ADMIN" as const,
        email: `${tag}_admin@example.com`,
        isActive: true,
        supplierId: null,
      };

      const concurrent = await Promise.allSettled([
        verifyDeliveryForUser(staffBoth as never, {
          idempotencyKey: randomUUID(),
          deliveryId: again.deliveryId,
          lines: [
            {
              deliveryItemId: items[0]!.id,
              quantityReceived: "5",
            },
          ],
          discrepancyNotes: "Short by 1",
        }),
        verifyDeliveryForUser(adminUser as never, {
          idempotencyKey: randomUUID(),
          deliveryId: again.deliveryId,
          lines: [
            {
              deliveryItemId: items[0]!.id,
              quantityReceived: "6",
            },
          ],
        }),
      ]);

      const ok = concurrent.filter((r) => r.status === "fulfilled");
      const bad = concurrent.filter((r) => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(bad.length).toBe(1);

      const grns = await prisma.grn.findMany({
        where: { deliveryId: again.deliveryId },
      });
      expect(grns).toHaveLength(1);

      const delivery = await prisma.delivery.findUniqueOrThrow({
        where: { id: again.deliveryId },
        include: { items: true },
      });
      expect(delivery.status).toBe("VERIFIED");
      // Original supplier submission preserved
      expect(delivery.items[0]?.quantityDelivered.toString()).toBe("6");

      const item = await prisma.orderItem.findUniqueOrThrow({
        where: { id: ids.item },
      });
      expect(Number(item.quantityVerifiedReceived.toString())).toBeLessThanOrEqual(
        10,
      );
      expect(item.unitPrice?.toString()).toBe("77.5");

      // No second GRN for same delivery
      await expect(
        verifyDeliveryForUser(staffBoth as never, {
          idempotencyKey: randomUUID(),
          deliveryId: again.deliveryId,
          lines: [
            {
              deliveryItemId: items[0]!.id,
              quantityReceived: "1",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    },
    90_000,
  );
});
