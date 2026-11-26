import "server-only";

import { requireSupplier } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

import { REQUEST_PAGE_SIZE } from "./constants";
import { RequestDomainError } from "./errors";
import { supplierRequestListQuerySchema } from "./schema";

export async function listSupplierRequestsForSupplier(rawQuery: {
  status?: string;
  page?: string | number;
}) {
  const user = await requireSupplier();
  const parsed = supplierRequestListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new RequestDomainError("VALIDATION", "Invalid filters.");
  }

  const companyId = user.companyId;
  const supplierId = user.supplierId!;
  const statusFilter = parsed.data.status;
  const listAll = !statusFilter || statusFilter === "ALL";

  const actionRequiredIds =
    statusFilter === "ACTION_REQUIRED"
      ? await loadActionRequiredRequestIds(companyId, supplierId)
      : null;

  const where =
    statusFilter === "ACTION_REQUIRED"
      ? {
          companyId,
          supplierId,
          id: { in: actionRequiredIds!.length ? actionRequiredIds! : ["__none__"] },
        }
      : {
          companyId,
          supplierId,
          ...(!listAll && statusFilter
            ? { status: statusFilter as never }
            : {}),
        };

  const [total, rows] = await prisma.$transaction([
    prisma.supplierRequest.count({ where }),
    prisma.supplierRequest.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip: (parsed.data.page - 1) * REQUEST_PAGE_SIZE,
      take: REQUEST_PAGE_SIZE,
      include: {
        brand: { select: { id: true, name: true } },
        _count: { select: { items: true } },
        items: {
          select: {
            availabilityOffer: {
              select: {
                priceAgreement: { select: { status: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map((row) => {
      const hasCounter = row.items.some(
        (item) =>
          item.availabilityOffer?.priceAgreement?.status === "COUNTER_PENDING",
      );
      return {
        id: row.id,
        status: row.status,
        brand: row.brand,
        itemCount: row._count.items,
        responseDeadline: row.responseDeadline,
        sentAt: row.sentAt,
        respondedAt: row.respondedAt,
        actionRequired: hasCounter || row.status === "NEW" || row.status === "PARTIALLY_RESPONDED",
        hasPendingCounter: hasCounter,
      };
    }),
    total,
    page: parsed.data.page,
    pageSize: REQUEST_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE)),
    status: parsed.data.status ?? null,
  };
}

async function loadActionRequiredRequestIds(
  companyId: string,
  supplierId: string,
) {
  const [open, counters] = await Promise.all([
    prisma.supplierRequest.findMany({
      where: {
        companyId,
        supplierId,
        status: { in: ["NEW", "PARTIALLY_RESPONDED"] },
      },
      select: { id: true },
    }),
    prisma.priceAgreement.findMany({
      where: {
        companyId,
        supplierId,
        status: "COUNTER_PENDING",
      },
      select: {
        availabilityOffer: {
          select: {
            requestItem: { select: { supplierRequestId: true } },
          },
        },
      },
    }),
  ]);

  const ids = new Set<string>();
  for (const row of open) ids.add(row.id);
  for (const row of counters) {
    ids.add(row.availabilityOffer.requestItem.supplierRequestId);
  }
  return [...ids];
}
