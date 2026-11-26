import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  requireAuthenticatedUser,
  requireStaffAreaPage,
  requireSupplier,
} from "@/lib/auth/guards";
import { AuthorizationError } from "@/lib/auth/errors";
import { createId } from "@/lib/id";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";

export async function createUserNotification(args: {
  userId: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  return client.notification.create({
    data: {
      id: createId(),
      userId: args.userId,
      title: args.title,
      body: args.body,
      entityType: args.entityType,
      entityId: args.entityId,
      status: "UNREAD",
    },
  });
}

/**
 * Create or refresh a single UNREAD notification for (user, entityType, entityId).
 * Prevents duplicate unread rows on retries / repeated events for the same entity.
 */
export async function upsertUnreadEntityNotification(args: {
  userId: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  const existing = await client.notification.findFirst({
    where: {
      userId: args.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      status: "UNREAD",
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return client.notification.update({
      where: { id: existing.id },
      data: {
        title: args.title,
        body: args.body,
        createdAt: new Date(),
      },
    });
  }
  return createUserNotification(args);
}

export async function countUnreadNotificationsForUser(userId: string) {
  return prisma.notification.count({
    where: { userId, status: "UNREAD" },
  });
}

export type NotificationAudience = "supplier" | "company";

export function notificationHref(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
  audience: NotificationAudience = "supplier",
): string {
  if (!entityType || !entityId) {
    return audience === "company"
      ? "/staff/notifications"
      : "/supplier/notifications";
  }
  if (audience === "company") {
    if (entityType === "SupplierRequest") {
      return `/staff/requests/${entityId}`;
    }
    if (entityType === "AvailabilityOffer") {
      return `/staff/notifications/open?offerId=${encodeURIComponent(entityId)}`;
    }
    if (entityType === "PurchaseOrder") {
      return `/staff/orders/${entityId}`;
    }
    if (entityType === "Delivery") {
      return `/staff/deliveries/${entityId}`;
    }
    return "/staff/notifications";
  }
  if (entityType === "SupplierRequest") {
    return `/supplier/requests/${entityId}`;
  }
  if (entityType === "AvailabilityOffer") {
    return `/supplier/notifications/open?offerId=${encodeURIComponent(entityId)}`;
  }
  if (entityType === "PurchaseOrder") {
    return `/supplier/orders/${entityId}`;
  }
  if (entityType === "Delivery") {
    return `/supplier/deliveries`;
  }
  return "/supplier/notifications";
}

function mapNotificationRows(
  rows: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    entityType: string | null;
    entityId: string | null;
    createdAt: Date;
  }>,
  audience: NotificationAudience,
) {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt,
    createdAtLabel: formatDateTime(row.createdAt),
    href: notificationHref(row.entityType, row.entityId, audience),
  }));
}

export async function listNotificationsForCurrentSupplier() {
  const user = await requireSupplier();
  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return mapNotificationRows(rows, "supplier");
}

/** ADMIN / STAFF inbox — session user only; suppliers cannot call this. */
export async function listNotificationsForCurrentCompanyUser() {
  const user = await requireStaffAreaPage();
  if (user.role === "SUPPLIER") {
    throw new AuthorizationError("FORBIDDEN");
  }
  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return mapNotificationRows(rows, "company");
}

export async function markNotificationRead(notificationId: string) {
  const user = await requireAuthenticatedUser();
  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, status: "UNREAD" },
    data: { status: "READ", readAt: new Date() },
  });
  return { updated: updated.count };
}

export async function markAllNotificationsReadForCurrentUser() {
  const user = await requireAuthenticatedUser();
  const updated = await prisma.notification.updateMany({
    where: { userId: user.id, status: "UNREAD" },
    data: { status: "READ", readAt: new Date() },
  });
  return { updated: updated.count };
}

async function resolveCompanyPriceRecipients(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  return tx.user.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { role: "ADMIN" },
        {
          role: "STAFF",
          staffPermissions: {
            some: {
              code: { in: ["ALLOCATE_ORDER", "SEND_SUPPLIER_REQUEST"] },
            },
          },
        },
      ],
    },
    select: { id: true },
    take: 50,
  });
}

/** Notify all active users for a supplier about a company price counter (deduped per offer). */
export async function notifySupplierUsersOfPriceCounter(args: {
  tx: Prisma.TransactionClient;
  companyId: string;
  supplierId: string;
  availabilityOfferId: string;
  supplierRequestId: string;
  productName: string;
  counterPrice: string;
  currencyCode: string;
}) {
  const users = await args.tx.user.findMany({
    where: {
      companyId: args.companyId,
      supplierId: args.supplierId,
      role: "SUPPLIER",
      isActive: true,
    },
    select: { id: true },
    take: 50,
  });

  const title = "Company price counteroffer";
  const body = `${args.productName}: company offers ${args.counterPrice} ${args.currencyCode}. Accept or revise on the request.`;

  for (const row of users) {
    await upsertUnreadEntityNotification({
      tx: args.tx,
      userId: row.id,
      title,
      body,
      entityType: "AvailabilityOffer",
      entityId: args.availabilityOfferId,
    });
  }

  return { notified: users.length };
}

/**
 * Notify company ADMIN + authorized STAFF that a supplier accepted a counter.
 * Deduped per offer via upsert so idempotent retries do not create duplicates.
 */
export async function notifyCompanyUsersOfPriceAcceptance(args: {
  tx: Prisma.TransactionClient;
  companyId: string;
  availabilityOfferId: string;
  supplierRequestId: string;
  productName: string;
  unitPrice: string;
  currencyCode: string;
  supplierName?: string;
  confirmedAt?: Date;
}) {
  const recipients = await resolveCompanyPriceRecipients(
    args.tx,
    args.companyId,
  );
  const when = formatDateTime(args.confirmedAt ?? new Date());
  const who = args.supplierName ? `${args.supplierName}` : "Supplier";
  const title = "Supplier accepted price counter";
  const body = `${who} · ${args.productName} confirmed at ${args.unitPrice} ${args.currencyCode} · ${when}`;

  for (const row of recipients) {
    await upsertUnreadEntityNotification({
      tx: args.tx,
      userId: row.id,
      title,
      body,
      entityType: "AvailabilityOffer",
      entityId: args.availabilityOfferId,
    });
  }

  return { notified: recipients.length };
}

/**
 * Notify company when supplier sends a revised price needing staff review.
 * Deduped per offer so retries do not stack unread rows.
 */
export async function notifyCompanyUsersOfPriceRevision(args: {
  tx: Prisma.TransactionClient;
  companyId: string;
  availabilityOfferId: string;
  supplierRequestId: string;
  productName: string;
  unitPrice: string;
  currencyCode: string;
  supplierName?: string;
  revisedAt?: Date;
}) {
  const recipients = await resolveCompanyPriceRecipients(
    args.tx,
    args.companyId,
  );
  const when = formatDateTime(args.revisedAt ?? new Date());
  const who = args.supplierName ? `${args.supplierName}` : "Supplier";
  const title = "Supplier revised price — review needed";
  const body = `${who} · ${args.productName} revised to ${args.unitPrice} ${args.currencyCode} · ${when}`;

  for (const row of recipients) {
    await upsertUnreadEntityNotification({
      tx: args.tx,
      userId: row.id,
      title,
      body,
      entityType: "AvailabilityOffer",
      entityId: args.availabilityOfferId,
    });
  }

  return { notified: recipients.length };
}

/** Test/helper: count unread for current authenticated user (session-scoped). */
export async function countUnreadNotificationsForCurrentUser() {
  const user = await requireAuthenticatedUser();
  return countUnreadNotificationsForUser(user.id);
}
