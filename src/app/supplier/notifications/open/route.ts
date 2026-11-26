import { NextResponse } from "next/server";

import { requireSupplier } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { markNotificationRead } from "@/lib/notifications";

/**
 * Resolve AvailabilityOffer notification → supplier request negotiation URL.
 * Marks matching unread notification as read when notificationId is provided.
 */
export async function GET(request: Request) {
  const user = await requireSupplier();
  const url = new URL(request.url);
  const offerId = url.searchParams.get("offerId");
  const notificationId = url.searchParams.get("notificationId");

  if (notificationId) {
    await markNotificationRead(notificationId);
  }

  if (!offerId) {
    return NextResponse.redirect(new URL("/supplier/notifications", url.origin));
  }

  const offer = await prisma.availabilityOffer.findFirst({
    where: {
      id: offerId,
      supplierId: user.supplierId!,
      requestItem: {
        supplierRequest: {
          companyId: user.companyId,
          supplierId: user.supplierId!,
        },
      },
    },
    select: {
      requestItem: { select: { supplierRequestId: true } },
    },
  });

  if (!offer) {
    return NextResponse.redirect(new URL("/supplier/notifications", url.origin));
  }

  const requestId = offer.requestItem.supplierRequestId;
  const target = new URL(
    `/supplier/requests/${requestId}?focus=counter&offer=${encodeURIComponent(offerId)}`,
    url.origin,
  );
  return NextResponse.redirect(target);
}
