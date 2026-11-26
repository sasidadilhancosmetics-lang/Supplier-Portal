import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { requireSupplier } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { lockCompanyCatalogue } from "@/lib/osf-imports/catalogue-lock";
import { lockSuppliers } from "@/lib/suppliers/locking";

const PAGE_SIZE = 24;
type Client = Pick<Prisma.TransactionClient, "$queryRaw">;
type Scope = { companyId: string; supplierId: string };
type ProductRow = {
  importId: string;
  productId: string | null;
  sku: string;
  title: string;
  brand: string;
  uom: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  unitPrice: string | null;
  moq: string | null;
  revision: number | null;
};

/** A single statement selects the import, applies catalogue access and loads only this supplier's price. */
async function eligibleProducts(client: Client, scope: Scope, options: {
  productId?: string; search?: string; page?: number;
}) {
  const { companyId, supplierId } = scope;
  const search = options.search ?? "";
  const rows = await client.$queryRaw<ProductRow[]>`
    WITH latest AS (
      SELECT id FROM "OsfImport" WHERE "companyId" = ${companyId}
        AND status = 'CONFIRMED' AND "confirmedAt" IS NOT NULL
      ORDER BY "confirmedAt" DESC, id DESC LIMIT 1
    ), eligible AS (
      SELECT DISTINCT p.id AS "productId", p.sku, p.name AS title, b.name AS brand, p."unitOfMeasure" AS uom
      FROM latest
      JOIN "OsfImportLine" l ON l."osfImportId" = latest.id AND l."companyId" = ${companyId}
      JOIN "Product" p ON p.id = l."productId" AND p."companyId" = l."companyId"
        AND p."brandId" = l."brandId" AND p.sku = l.sku AND p."isActive" AND btrim(p.sku) <> ''
      JOIN "Brand" b ON b.id = p."brandId" AND b."companyId" = p."companyId"
      JOIN "Supplier" s ON s.id = ${supplierId} AND s."companyId" = p."companyId" AND s.status = 'ACTIVE'
      JOIN "SupplierBrand" sb ON sb."supplierId" = s.id AND sb."brandId" = b.id
      WHERE l."mappingStatus" = 'MATCHED_SKU' AND l."quantityPlanned" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "SupplierCatalogueSkuExclusion" x
          WHERE x."companyId" = p."companyId" AND x."supplierId" = s.id AND x."productId" = p.id
        )
        ${options.productId ? Prisma.sql`AND p.id = ${options.productId}` : Prisma.empty}
        ${search ? Prisma.sql`AND (
          strpos(lower(p.sku), lower(${search})) > 0 OR strpos(lower(p.name), lower(${search})) > 0
          OR strpos(lower(b.name), lower(${search})) > 0
        )` : Prisma.empty}
    ), paged AS (
      SELECT * FROM eligible
      ORDER BY (lower(sku) = lower(${search})) DESC, lower(title), "productId"
      LIMIT ${PAGE_SIZE + 1} OFFSET ${((options.page ?? 1) - 1) * PAGE_SIZE}
    )
    SELECT latest.id AS "importId", e.*, media."imageUrl", media."imageAlt",
           price."unitPrice"::text, price.moq::text, price.revision
    FROM latest LEFT JOIN paged e ON true
    LEFT JOIN "ProductCatalogueMedia" media ON media."companyId" = ${companyId} AND media."productId" = e."productId"
      AND media."mappedSku" = e.sku AND media.status = 'APPROVED'
    LEFT JOIN LATERAL (
      SELECT r."unitPrice", r.moq, r.revision FROM "SupplierCataloguePriceRevision" r
      WHERE r."companyId" = ${companyId} AND r."supplierId" = ${supplierId} AND r."productId" = e."productId"
      ORDER BY r.revision DESC LIMIT 1
    ) price ON true
    ORDER BY (lower(e.sku) = lower(${search})) DESC NULLS LAST, lower(e.title), e."productId"
  `;
  const products = rows.filter((row): row is ProductRow & { productId: string } => row.productId !== null);
  return { importId: rows[0]?.importId ?? null, products: products.slice(0, PAGE_SIZE), hasMore: products.length > PAGE_SIZE };
}

export async function listSupplierCatalogue(search: string, page: number) {
  const user = await requireSupplier();
  const scope = { companyId: user.companyId, supplierId: user.supplierId! };
  return eligibleProducts(prisma, scope, { search, page });
}

export async function getSupplierCatalogueProduct(productId: string, before?: number) {
  const user = await requireSupplier();
  const scope = { companyId: user.companyId, supplierId: user.supplierId! };
  return prisma.$transaction(async (tx) => {
    const { products } = await eligibleProducts(tx, scope, { productId });
    const product = products[0];
    if (!product) return null;
    const history = await tx.supplierCataloguePriceRevision.findMany({
      where: { ...scope, productId, ...(before ? { revision: { lt: before } } : {}) }, orderBy: { revision: "desc" },
      take: 21, select: { revision: true, unitPrice: true, moq: true, unitOfMeasure: true, createdAt: true },
    });
    return {
      product,
      history: history.slice(0, 20).map((row) => ({ ...row, unitPrice: row.unitPrice.toString(), moq: row.moq?.toString() ?? null })),
      nextBefore: history.length > 20 ? history[19].revision : null,
    };
  }, { isolationLevel: "RepeatableRead" });
}

function positiveDecimal(integers: number, fraction: number) {
  return z.string().trim().regex(new RegExp(`^\\d{1,${integers}}(?:\\.\\d{1,${fraction}})?$`))
    .refine((value) => /[1-9]/.test(value), "Enter a value greater than zero.")
    .transform((value) => new Prisma.Decimal(value).toString());
}

export const cataloguePriceInput = z.strictObject({
  productId: z.string().min(1).max(128),
  osfImportId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  idempotencyKey: z.uuid(),
  unitPrice: positiveDecimal(16, 2),
  moq: positiveDecimal(14, 4).nullable().default(null),
});

export async function saveCataloguePrice(raw: unknown) {
  const user = await requireSupplier();
  const input = cataloguePriceInput.safeParse(raw);
  if (!input.success) return { status: "INVALID" } as const;
  const { productId, osfImportId, expectedRevision, idempotencyKey, unitPrice, moq } = input.data;
  const scope = { companyId: user.companyId, supplierId: user.supplierId! };
  const key = { ...scope, productId };
  const payloadHash = createHash("sha256").update(JSON.stringify(input.data)).digest("hex");
  return prisma.$transaction(async (tx) => {
    if (!await lockCompanyCatalogue(tx, scope.companyId, "save-price")) {
      return { status: "UNAVAILABLE" } as const;
    }
    const locked = await lockSuppliers(tx, scope.companyId, [scope.supplierId]);
    if (!locked.length) return { status: "UNAVAILABLE" } as const;
    const result = await eligibleProducts(tx, scope, { productId });
    const product = result.products[0];
    if (!product) return { status: "UNAVAILABLE" } as const;
    if (result.importId !== osfImportId) return { status: "CONFLICT" } as const;
    const replay = await tx.supplierCataloguePriceRevision.findFirst({
      where: { ...key, idempotencyKey }, select: { payloadHash: true, revision: true, unitPrice: true, moq: true },
    });
    if (replay) {
      if (replay.payloadHash !== payloadHash) return { status: "CONFLICT" } as const;
      return { status: "SAVED", revision: replay.revision, unitPrice: replay.unitPrice.toString(), moq: replay.moq?.toString() ?? null } as const;
    }
    if ((product.revision ?? 0) !== expectedRevision) return { status: "CONFLICT" } as const;
    if (product.uom !== null && (product.uom.trim() === "" || product.uom.length > 128)) return { status: "INVALID" } as const;
    const revision = expectedRevision + 1;
    await tx.supplierCataloguePriceRevision.create({
      data: { ...key, revision, unitPrice, moq, unitOfMeasure: product.uom, actorUserId: user.id, idempotencyKey, payloadHash },
    });
    return { status: "SAVED", revision, unitPrice, moq } as const;
  }, { isolationLevel: "ReadCommitted" });
}

/** Assigned request ownership is already verified. Request permissions remain independent of catalogue visibility. */
export async function loadSavedRequestPrices(scope: Scope, productIds: string[]) {
  if (!productIds.length) return [];
  return prisma.$queryRaw<{
    productId: string; unitPrice: string; moq: string | null; unitOfMeasure: string | null; currencyCode: string;
  }[]>`
    SELECT DISTINCT ON ("productId") "productId", "unitPrice"::text, moq::text, "unitOfMeasure", "currencyCode"
    FROM "SupplierCataloguePriceRevision"
    WHERE "companyId" = ${scope.companyId} AND "supplierId" = ${scope.supplierId}
      AND "productId" IN (${Prisma.join(productIds)})
    ORDER BY "productId", revision DESC
  `;
}
