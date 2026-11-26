import { NextResponse } from "next/server";

import { requireStaffAreaPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { markNotificationRead } from "@/lib/notifications";

/**
 * Resolve AvailabilityOffer notification → staff negotiate page.
 * Company-scoped; suppliers cannot use this route (staff-area guard).
 */
export async function GET(request: Request) {
  const user = await requireStaffAreaPage();
  const url = new URL(request.url);
  const offerId = url.searchParams.get("offerId");
  const notificationId = url.searchParams.get("notificationId");

  if (notificationId) {
    await markNotificationRead(notificationId);
  }

  if (!offerId) {
    return NextResponse.redirect(new URL("/staff/notifications", url.origin));
  }

  const offer = await prisma.availabilityOffer.findFirst({
    where: {
      id: offerId,
      requestItem: {
        supplierRequest: { companyId: user.companyId },
      },
    },
    select: { id: true },
  });

  if (!offer) {
    return NextResponse.redirect(new URL("/staff/notifications", url.origin));
  }

  return NextResponse.redirect(
    new URL(`/staff/offers/${offer.id}/negotiate`, url.origin),
  );
}
