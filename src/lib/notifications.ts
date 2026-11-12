import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { createId } from "@/lib/id";
import { prisma } from "@/lib/db";

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
