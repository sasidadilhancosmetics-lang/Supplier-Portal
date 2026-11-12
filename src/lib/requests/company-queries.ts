import "server-only";

import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { REQUEST_PAGE_SIZE } from "./constants";
import { RequestDomainError } from "./errors";
import { expireOfferIfNeeded } from "./availability";
import { supplierRequestListQuerySchema } from "./schema";

/** Company review of sent supplier requests and availability. */
export async function listCompanySupplierRequests(rawQuery: {
  status?: string;
  page?: string | number;
}) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const parsed = supplierRequestListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new RequestDomainError("VALIDATION", "Invalid filters.");
  }

  const where = {
    companyId: user.companyId,
    ...(parsed.data.status ? { status: parsed.data.status as never } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.supplierRequest.count({ where }),
    prisma.supplierRequest.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip: (parsed.data.page - 1) * REQUEST_PAGE_SIZE,
      take: REQUEST_PAGE_SIZE,
      include: {
        brand: { select: { name: true } },
        supplier: { select: { id: true, name: true } },
        requirement: { select: { id: true, title: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      brandName: row.brand.name,
      supplier: row.supplier,
      requirement: row.requirement,
      itemCount: row._count.items,
      responseDeadline: row.responseDeadline,
      sentAt: row.sentAt,
      respondedAt: row.respondedAt,
    })),
    total,
    page: parsed.data.page,
    pageSize: REQUEST_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE)),
    status: parsed.data.status ?? null,
  };
}

export async function getCompanySupplierRequest(supplierRequestId: string) {
  const user = await requireStaffPermission("SEND_SUPPLIER_REQUEST");
  const request = await prisma.supplierRequest.findFirst({
    where: { id: supplierRequestId, companyId: user.companyId },
    include: {
      brand: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, status: true } },
      requirement: {
        select: {
          id: true,
          title: true,
          items: {
            select: {
              id: true,
              quantityPlanned: true,
              productId: true,
            },
          },
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              priorityStatus: true,
              unitOfMeasure: true,
            },
          },
          availabilityOffer: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!request) {
    throw new RequestDomainError("NOT_FOUND", "Request not found.");
  }

  const now = new Date();
  const lines = [];
  for (const item of request.items) {
    let offer = item.availabilityOffer;
    if (offer) {
      offer = await expireOfferIfNeeded(offer.id, offer.supplierId);
    }

    const required = Number(item.quantityRequested);
    const declared =
      offer && (offer.status === "SUBMITTED" || offer.status === "EXPIRED")
        ? Number(offer.quantityDeclared)
        : null;
    const ordered = offer ? Number(offer.quantityOrderedActive) : 0;
    const reserveValid =
      offer?.status === "SUBMITTED" &&
      offer.reserveExpiresAt &&
      offer.reserveExpiresAt.getTime() > now.getTime();
    const remainingAllocatable =
      reserveValid && declared !== null
        ? Math.max(0, declared - ordered)
        : 0;
    const shortage =
      declared === null
        ? required
        : offer?.status === "NOT_AVAILABLE"
          ? required
          : Math.max(0, required - declared);

    lines.push({
      id: item.id,
      quantityRequested: item.quantityRequested.toString(),
      product: item.product,
      offer: offer
        ? {
            status: offer.status,
            quantityDeclared: offer.quantityDeclared.toString(),
            quantityOrderedActive: offer.quantityOrderedActive.toString(),
            availableDate: offer.availableDate,
            reservedAt: offer.reservedAt,
            reserveExpiresAt: offer.reserveExpiresAt,
            notes: offer.notes,
          }
        : null,
      remainingAllocatable: remainingAllocatable.toString(),
      shortage: shortage.toString(),
      reserveValid: Boolean(reserveValid),
    });
  }

  return {
    id: request.id,
    status: request.status,
    responseDeadline: request.responseDeadline,
    sentAt: request.sentAt,
    respondedAt: request.respondedAt,
    brand: request.brand,
    supplier: request.supplier,
    requirement: request.requirement,
    lines,
  };
}
