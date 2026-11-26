import "server-only";

import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/auth/errors";
import { historyQuerySchema, lookupPurchaseHistory } from "@/lib/integrations/cosmo/purchase-history";
import { readStockSnapshot } from "@/lib/osf-imports/stock-snapshot";
import { requireRequirementReadAccess } from "@/lib/requirements/access";

type CataloguePrice = {
  supplierId: string; supplierName: string; unitPrice: string; currencyCode: string;
  unitOfMeasure: string | null; moq: string | null; createdAt: Date;
};

export async function findProductPurchaseHistoryLink(productId: string, sku: string | null) {
  const user = await requireRequirementReadAccess();
  if (!sku) return null;
  const line = await prisma.osfImportLine.findFirst({
    where: {
      companyId: user.companyId, productId, sku, mappingStatus: "MATCHED_SKU",
      product: { companyId: user.companyId },
      osfImport: { companyId: user.companyId, status: "CONFIRMED", confirmedAt: { not: null } },
    },
    orderBy: [{ osfImport: { confirmedAt: "desc" } }, { osfImportId: "desc" }, { sourceIndex: "asc" }],
    select: { id: true, osfImportId: true },
  });
  return line ? `/staff/osf-imports/${encodeURIComponent(line.osfImportId)}/purchase-history/${encodeURIComponent(line.id)}` : null;
}

export async function getOsfPurchaseHistory(importId: string, lineId: string, rawQuery: unknown) {
  const user = await requireRequirementReadAccess();
  const line = await prisma.osfImportLine.findFirst({
    where: { id: lineId, osfImportId: importId, companyId: user.companyId },
    select: {
      sku: true, lineKey: true, sourceIndex: true, product: {
        select: { id: true, name: true, sku: true, companyId: true },
      },
      osfImport: { select: { payload: true } },
    },
  });
  if (!line?.product || line.product.companyId !== user.companyId) throw new AuthorizationError("NOT_FOUND");

  const columns = readStockSnapshot(line.osfImport.payload).columnsForLine(line.sourceIndex, line.lineKey, line.sku);
  const instances = line.product.sku === line.sku
    ? [...new Set(columns.filter((column) => column.itemCode === line.sku).map((column) => column.erpInstanceId))]
    : [];
  const prices = await prisma.$queryRaw<CataloguePrice[]>`
    SELECT DISTINCT ON (r."supplierId")
      r."supplierId", s.name AS "supplierName", r."unitPrice"::text, r."currencyCode",
      r."unitOfMeasure", r.moq::text, r."createdAt"
    FROM "SupplierCataloguePriceRevision" r
    JOIN "Supplier" s ON s.id = r."supplierId" AND s."companyId" = r."companyId"
    WHERE r."companyId" = ${user.companyId} AND r."productId" = ${line.product.id}
    ORDER BY r."supplierId", r.revision DESC
  `;
  const query = historyQuerySchema.safeParse(rawQuery);
  const instance = query.success ? query.data.instanceId : null;
  const result = !query.success ? { status: "INVALID_FILTER" } as const
    : !instances.length ? { status: "MAPPING_UNAVAILABLE" } as const
    : !instance ? { status: "SELECT_INSTANCE" } as const
    : !instances.includes(instance) ? { status: "MAPPING_UNAVAILABLE" } as const
    : await lookupPurchaseHistory(user.companyId, {
        instanceId: instance, sku: line.sku, itemCode: line.sku, from: query.data.from, to: query.data.to,
        erpCompany: query.data.erpCompany,
        offset: query.data.offset ?? 0,
      });
  return { product: line.product, instances, prices, result };
}
