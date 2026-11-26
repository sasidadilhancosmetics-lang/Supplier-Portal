import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  requireAuthenticatedUser,
  requireSupplier,
  requireStaffAreaPage,
  prisma,
  createId,
} = vi.hoisted(() => {
  const prisma = {
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  };
  return {
    requireAuthenticatedUser: vi.fn(),
    requireSupplier: vi.fn(),
    requireStaffAreaPage: vi.fn(),
    prisma,
    createId: vi.fn(() => "notif_new"),
  };
});

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticatedUser,
  requireSupplier,
  requireStaffAreaPage,
}));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/id", () => ({ createId }));

vi.mock("@/lib/dates", () => ({
  formatDateTime: (d: Date) => d.toISOString(),
}));

import {
  listNotificationsForCurrentCompanyUser,
  markAllNotificationsReadForCurrentUser,
  markNotificationRead,
  notificationHref,
  notifyCompanyUsersOfPriceAcceptance,
  notifyCompanyUsersOfPriceRevision,
  notifySupplierUsersOfPriceCounter,
  upsertUnreadEntityNotification,
} from "./notifications";

describe("notificationHref", () => {
  it("links AvailabilityOffer to supplier open resolver by default", () => {
    expect(notificationHref("AvailabilityOffer", "offer_1")).toBe(
      "/supplier/notifications/open?offerId=offer_1",
    );
  });

  it("links company audience to staff open resolver", () => {
    expect(notificationHref("AvailabilityOffer", "offer_1", "company")).toBe(
      "/staff/notifications/open?offerId=offer_1",
    );
    expect(notificationHref("SupplierRequest", "sr_1", "company")).toBe(
      "/staff/requests/sr_1",
    );
  });

  it("links SupplierRequest directly for suppliers", () => {
    expect(notificationHref("SupplierRequest", "sr_1")).toBe(
      "/supplier/requests/sr_1",
    );
  });
});

describe("upsertUnreadEntityNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates existing unread instead of creating a duplicate", async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: "notif_existing",
      status: "UNREAD",
    });
    prisma.notification.update.mockResolvedValue({ id: "notif_existing" });

    await upsertUnreadEntityNotification({
      userId: "u1",
      title: "Company price counteroffer",
      body: "updated body",
      entityType: "AvailabilityOffer",
      entityId: "offer_1",
    });

    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "notif_existing" },
        data: expect.objectContaining({
          title: "Company price counteroffer",
          body: "updated body",
        }),
      }),
    );
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("creates when no unread exists for the entity", async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "notif_new" });

    await upsertUnreadEntityNotification({
      userId: "u1",
      title: "Company price counteroffer",
      body: "body",
      entityType: "AvailabilityOffer",
      entityId: "offer_1",
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          entityType: "AvailabilityOffer",
          entityId: "offer_1",
          status: "UNREAD",
        }),
      }),
    );
  });
});

describe("notifySupplierUsersOfPriceCounter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies only active supplier users and dedupes per offer", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u_sup" }]);
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "notif_new" });

    const tx = prisma;
    const result = await notifySupplierUsersOfPriceCounter({
      tx: tx as never,
      companyId: "co_1",
      supplierId: "sup_1",
      availabilityOfferId: "offer_1",
      supplierRequestId: "sr_1",
      productName: "Serum",
      counterPrice: "90",
      currencyCode: "LKR",
    });

    expect(result.notified).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: "co_1",
          supplierId: "sup_1",
          role: "SUPPLIER",
          isActive: true,
        },
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe("notifyCompanyUsersOfPriceAcceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies ADMIN/authorized staff once per offer via upsert", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u_admin" }, { id: "u_staff" }]);
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "notif_new" });

    const result = await notifyCompanyUsersOfPriceAcceptance({
      tx: prisma as never,
      companyId: "co_1",
      availabilityOfferId: "offer_1",
      supplierRequestId: "sr_1",
      productName: "Serum",
      unitPrice: "90",
      currencyCode: "LKR",
      supplierName: "Acme",
      confirmedAt: new Date("2026-11-16T05:00:00.000Z"),
    });

    expect(result.notified).toBe(2);
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create.mock.calls[0][0].data.body).toContain(
      "Acme",
    );
    expect(prisma.notification.create.mock.calls[0][0].data.body).toContain(
      "90",
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "co_1",
          OR: expect.any(Array),
        }),
      }),
    );

    prisma.notification.findFirst.mockResolvedValue({
      id: "notif_existing",
      status: "UNREAD",
    });
    prisma.notification.update.mockResolvedValue({ id: "notif_existing" });
    await notifyCompanyUsersOfPriceAcceptance({
      tx: prisma as never,
      companyId: "co_1",
      availabilityOfferId: "offer_1",
      supplierRequestId: "sr_1",
      productName: "Serum",
      unitPrice: "90",
      currencyCode: "LKR",
    });
    expect(prisma.notification.update).toHaveBeenCalled();
  });
});

describe("notifyCompanyUsersOfPriceRevision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates revised-price alert for company users", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u_admin" }]);
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "notif_new" });

    const result = await notifyCompanyUsersOfPriceRevision({
      tx: prisma as never,
      companyId: "co_1",
      availabilityOfferId: "offer_1",
      supplierRequestId: "sr_1",
      productName: "Serum",
      unitPrice: "95",
      currencyCode: "LKR",
      supplierName: "Acme",
    });

    expect(result.notified).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Supplier revised price — review needed",
          entityType: "AvailabilityOffer",
          entityId: "offer_1",
        }),
      }),
    );
  });
});

describe("company notification list isolation", () => {
  it("lists only the session company user inbox", async () => {
    requireStaffAreaPage.mockResolvedValue({
      id: "u_staff",
      role: "STAFF",
      companyId: "co_1",
    });
    prisma.notification.findMany.mockResolvedValue([]);
    await listNotificationsForCurrentCompanyUser();
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u_staff" } }),
    );
  });
});

describe("mark read helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedUser.mockResolvedValue({ id: "u1" });
  });

  it("marks a single notification only for the current user", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const result = await markNotificationRead("notif_1");
    expect(result.updated).toBe(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "notif_1", userId: "u1", status: "UNREAD" },
      data: { status: "READ", readAt: expect.any(Date) },
    });
  });

  it("marks all unread for the current user", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const result = await markAllNotificationsReadForCurrentUser();
    expect(result.updated).toBe(3);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", status: "UNREAD" },
      data: { status: "READ", readAt: expect.any(Date) },
    });
  });
});

describe("supplier isolation on list", () => {
  it("lists notifications only for the session supplier user", async () => {
    requireSupplier.mockResolvedValue({
      id: "u_sup",
      companyId: "co_1",
      supplierId: "sup_1",
      role: "SUPPLIER",
    });
    prisma.notification.findMany.mockResolvedValue([]);

    const { listNotificationsForCurrentSupplier } = await import(
      "./notifications"
    );
    await listNotificationsForCurrentSupplier();

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u_sup" },
      }),
    );
  });
});
