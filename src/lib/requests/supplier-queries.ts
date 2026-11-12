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

  const where = {
    companyId: user.companyId,
    supplierId: user.supplierId!,
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
        brand: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      brand: row.brand,
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
