import "server-only";

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

import { Prisma, type ProductCatalogueMedia } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { catalogueImageUrl } from "@/lib/supplier/catalogue-image";

const version = "cosmo-product-media.v1";
const id = z.string().min(1).max(128);
const configSchema = z.strictObject({
  origin: z.string().max(253),
  approvedOrigin: z.string().max(253),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  companyId: id,
  locationId: id,
  storeHostname: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/),
});
const candidateSchema = z.strictObject({
  cosmoProductItemId: id,
  shopifyProductId: z.string().regex(/^[1-9][0-9]{0,29}$/),
  shopifyVariantId: z.string().regex(/^[1-9][0-9]{0,29}$/),
  imageUrl: z.string().max(2000).nullable(),
  imageAlt: z.string().max(500).nullable(),
  sourceUpdatedAt: z.iso.datetime(),
});
const responseSchema = z.strictObject({
  contractVersion: z.literal(version),
  requestId: z.uuid(),
  source: z.strictObject({ companyId: id, locationId: id, storeHostname: z.string() }),
  items: z.array(z.strictObject({
    sku: z.string().min(1).max(200),
    status: z.enum(["MATCHED", "NO_PHOTO", "NOT_FOUND", "AMBIGUOUS"]),
    candidates: z.array(candidateSchema).max(5),
    truncated: z.boolean(),
  })).min(1).max(100),
});
type Binding = z.infer<typeof configSchema>;

function bindingForCompany(companyId: string) {
  try {
    const bindings = z.record(z.string(), configSchema).parse(JSON.parse(process.env.PORTAL_COSMO_PRODUCT_MEDIA_JSON ?? "{}"));
    return Object.hasOwn(bindings, companyId) ? bindings[companyId] : null;
  } catch {
    return null;
  }
}

export async function lookupPhotos(binding: Binding, destinationCompanyId: string, skus: string[], request = fetch) {
  const origin = new URL(binding.origin);
  if (binding.origin !== origin.origin || origin.origin !== binding.approvedOrigin ||
      origin.protocol !== "https:" || origin.port || !origin.hostname.includes(".") || isIP(origin.hostname)) {
    throw new Error("MEDIA_ORIGIN");
  }
  const requestId = randomUUID();
  const response = await request(new URL("/api/integrations/supplier-portal/v1/product-media/lookup", origin), {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${binding.token}`,
      "X-Portal-Company-Id": destinationCompanyId,
    },
    body: JSON.stringify({ contractVersion: version, requestId, skus }),
  });
  if (!response.ok) throw new Error("MEDIA_UNAVAILABLE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("MEDIA_RESPONSE");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024) {
        await reader.cancel().catch(() => undefined);
        throw new Error("MEDIA_RESPONSE");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const result = responseSchema.parse(JSON.parse(body + decoder.decode()));

  if (result.source.companyId !== binding.companyId || result.source.locationId !== binding.locationId ||
      result.source.storeHostname !== binding.storeHostname || result.requestId !== requestId ||
      result.items.length !== skus.length) throw new Error("MEDIA_BINDING");
  const bySku = new Map(result.items.map((item) => [item.sku, item]));
  for (const sku of skus) {
    const item = bySku.get(sku);
    if (!item ||
        ((item.status === "MATCHED" || item.status === "NO_PHOTO") && (item.candidates.length !== 1 || item.truncated)) ||
        (item.status === "NOT_FOUND" && (item.candidates.length || item.truncated)) ||
        (item.status === "AMBIGUOUS" && item.candidates.length < 2)) throw new Error("MEDIA_BINDING");
  }
  return bySku;
}

const BATCH_SIZE = 20;
type MediaItem = z.infer<typeof responseSchema>["items"][number];
type Product = { id: string; sku: string; skuMatches: number };
type Outcome = "UNCONFIGURED" | "UNAVAILABLE" | "STALE" | "NEEDS_REVIEW" | "APPROVED" | "FAILED";
type MediaResult = { outcome: Outcome; candidates?: { id: string; variant: string; imageUrl: string | null }[] };

function latestProducts(companyId: string, selection: { productId?: string; after?: string }) {
  return prisma.$queryRaw<Product[]>`
    WITH latest AS (
      SELECT id FROM "OsfImport" WHERE "companyId" = ${companyId}
        AND status = 'CONFIRMED' AND "confirmedAt" IS NOT NULL
      ORDER BY "confirmedAt" DESC, id DESC LIMIT 1
    ), products AS (
      SELECT DISTINCT p.id, p.sku FROM latest
      JOIN "OsfImportLine" l ON l."osfImportId" = latest.id AND l."companyId" = ${companyId}
      JOIN "Product" p ON p.id = l."productId" AND p."companyId" = l."companyId"
        AND p."brandId" = l."brandId" AND p.sku = l.sku AND p."isActive"
      JOIN "Brand" b ON b.id = p."brandId" AND b."companyId" = p."companyId"
      WHERE l."mappingStatus" = 'MATCHED_SKU' AND l."quantityPlanned" > 0 AND btrim(p.sku) <> ''
    ), counted AS (
      SELECT id, sku, (count(*) OVER (PARTITION BY sku))::int AS "skuMatches" FROM products
    )
    SELECT * FROM counted WHERE ${selection.productId
      ? Prisma.sql`id = ${selection.productId}`
      : Prisma.sql`id > ${selection.after ?? ""}`}
    ORDER BY id LIMIT ${selection.productId ? 1 : BATCH_SIZE + 1}
  `;
}

function sourceIdentity(binding: Binding) {
  return { sourceCompanyId: binding.companyId, sourceLocationId: binding.locationId, storeHostname: binding.storeHostname };
}

function claimPhoto(companyId: string, product: Product, binding: Binding) {
  const key = { companyId, productId: product.id };
  return prisma.productCatalogueMedia.upsert({
    where: { companyId_productId: key },
    create: { ...key, ...sourceIdentity(binding), mappedSku: product.sku },
    update: { refreshVersion: { increment: 1 } },
  });
}

function mediaFence(claim: ProductCatalogueMedia, sku: string) {
  return {
    companyId: claim.companyId, productId: claim.productId, refreshVersion: claim.refreshVersion,
    product: { sku, isActive: true },
  };
}

async function publishPhoto(args: {
  binding: Binding; actorUserId: string; product: Product; claim: ProductCatalogueMedia;
  item: MediaItem; reviewedCosmoItemId?: string;
}): Promise<MediaResult> {
  const { binding, actorUserId, product, claim, item, reviewedCosmoItemId } = args;
  const source = sourceIdentity(binding);
  const fence = mediaFence(claim, product.sku);
  const sameSource = claim.sourceCompanyId === source.sourceCompanyId && claim.sourceLocationId === source.sourceLocationId &&
    claim.storeHostname === source.storeHostname && claim.mappedSku === product.sku;
  const sameVariant = (row: z.infer<typeof candidateSchema>) => sameSource &&
    claim.cosmoProductItemId === row.cosmoProductItemId && claim.shopifyProductId === row.shopifyProductId &&
    claim.shopifyVariantId === row.shopifyVariantId;
  const candidate = reviewedCosmoItemId
    ? item.candidates.find((row) => row.cosmoProductItemId === reviewedCosmoItemId)
    : item.candidates.length === 1 ? item.candidates[0]
      : claim.reviewedAt ? item.candidates.find(sameVariant) : undefined;
  if (reviewedCosmoItemId && !candidate) return { outcome: "STALE" };
  const review = product.skuMatches > 1 || (!reviewedCosmoItemId && (
    (item.status === "AMBIGUOUS" && !candidate) ||
    (candidate && claim.cosmoProductItemId && !sameVariant(candidate))
  ));
  if (candidate && !review && claim.sourceUpdatedAt && sameVariant(candidate) &&
      Date.parse(candidate.sourceUpdatedAt) < claim.sourceUpdatedAt.getTime()) return { outcome: "STALE" };
  const photo = catalogueImageUrl(candidate?.imageUrl ?? null);
  const status = review ? "NEEDS_REVIEW" : candidate && photo ? "APPROVED" : "UNAVAILABLE";
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.productCatalogueMedia.updateMany({
        where: fence,
        data: {
          status, lastSuccessfulRefreshAt: new Date(), refreshFailedAt: null,
          ...(review ? {} : {
            ...source, mappedSku: product.sku,
            cosmoProductItemId: candidate?.cosmoProductItemId ?? null,
            shopifyProductId: candidate?.shopifyProductId ?? null,
            shopifyVariantId: candidate?.shopifyVariantId ?? null,
            sourceUpdatedAt: candidate ? new Date(candidate.sourceUpdatedAt) : null,
            imageUrl: photo, imageAlt: candidate?.imageAlt ?? null,
            reviewedAt: reviewedCosmoItemId ? new Date() : candidate && sameVariant(candidate) ? claim.reviewedAt : null,
          }),
        },
      });
      if (result.count && reviewedCosmoItemId && !review) await writeAuditLog({
        tx, entityType: "Product", entityId: product.id, actorUserId,
        action: "CATALOGUE_PHOTO_REVIEWED", afterJson: { status, sourceVariant: candidate?.shopifyVariantId ?? null },
      });
      return result.count;
    });
    if (!updated) return { outcome: "STALE" };
    return {
      outcome: status,
      ...(review && product.skuMatches === 1 ? { candidates: item.candidates.map((row) => ({
        id: row.cosmoProductItemId, variant: row.shopifyVariantId, imageUrl: catalogueImageUrl(row.imageUrl),
      })) } : {}),
    };
  } catch (error) {
    if (!(typeof error === "object" && error && "code" in error && error.code === "P2002")) throw error;
    const result = await prisma.productCatalogueMedia.updateMany({ where: fence, data: { status: "NEEDS_REVIEW" } });
    return { outcome: result.count ? "NEEDS_REVIEW" : "STALE" };
  }
}

async function refreshPhotos(selection: { productId?: string; reviewedCosmoItemId?: string; after?: string }) {
  const admin = await requireAdmin();
  const binding = bindingForCompany(admin.companyId);
  if (!binding) return { results: [{ outcome: "UNCONFIGURED" } satisfies MediaResult], next: null };
  const products = await latestProducts(admin.companyId, selection);
  const batch = products.slice(0, BATCH_SIZE);
  const next = products.length > BATCH_SIZE ? batch.at(-1)!.id : null;
  if (!batch.length) return { results: [], next };
  const claims = await Promise.all(batch.map((product) => claimPhoto(admin.companyId, product, binding)));
  let items: Awaited<ReturnType<typeof lookupPhotos>>;
  try {
    items = await lookupPhotos(binding, admin.companyId, [...new Set(batch.map(({ sku }) => sku))]);
  } catch {
    await Promise.all(batch.map(({ sku }, index) => prisma.productCatalogueMedia.updateMany({
      where: mediaFence(claims[index], sku), data: { refreshFailedAt: new Date() },
    })));
    return { results: batch.map(() => ({ outcome: "FAILED" } satisfies MediaResult)), next: null };
  }
  const results: MediaResult[] = [];
  for (const [index, product] of batch.entries()) {
    results.push(await publishPhoto({
      binding, actorUserId: admin.id, product, claim: claims[index], item: items.get(product.sku)!,
      reviewedCosmoItemId: selection.reviewedCosmoItemId,
    }));
  }
  return { results, next };
}

export async function refreshCataloguePhoto(productId: string, reviewedCosmoItemId?: string): Promise<MediaResult> {
  const { results } = await refreshPhotos({ productId, reviewedCosmoItemId });
  return results[0] ?? { outcome: "UNAVAILABLE" };
}

export async function refreshCataloguePhotoBatch(after?: string) {
  return refreshPhotos({ after });
}
