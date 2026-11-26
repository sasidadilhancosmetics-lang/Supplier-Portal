import { afterEach, describe, expect, it, vi } from "vitest";

const { db, requireAdmin } = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    productCatalogueMedia: { upsert: vi.fn(), updateMany: vi.fn() },
  },
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/guards", () => ({ requireAdmin }));

import { catalogueImageUrl } from "@/lib/supplier/catalogue-image";
import { lookupPhotos, refreshCataloguePhoto } from "./product-media";

const source = { companyId: "cosmo", locationId: "location", storeHostname: "example.myshopify.com" };
const binding = { ...source, origin: "https://cosmo.example.test", approvedOrigin: "https://cosmo.example.test", token: "synthetic" };

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function service(patch: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (_url, options) => {
    const { requestId } = JSON.parse(String(options?.body));
    return Response.json({
      contractVersion: "cosmo-product-media.v1", requestId, source,
      items: [{ sku: "SKU-1", status: "NOT_FOUND", candidates: [], truncated: false }], ...patch,
    });
  });
}

describe("Cosmo product media transport", () => {
  it("uses the fixed HTTPS endpoint, destination binding and no redirects", async () => {
    const request = service();
    const photos = await lookupPhotos(binding, "portal", ["SKU-1"], request);
    expect(photos.get("SKU-1")?.status).toBe("NOT_FOUND");
    expect(String(request.mock.calls[0][0])).toBe("https://cosmo.example.test/api/integrations/supplier-portal/v1/product-media/lookup");
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { "X-Portal-Company-Id": "portal" } });
  });

  it("rejects another store or location and an unapproved origin", async () => {
    await expect(lookupPhotos(binding, "portal", ["SKU-1"], service({ source: { ...source, locationId: "other" } }))).rejects.toThrow("MEDIA_BINDING");
    const request = service();
    await expect(lookupPhotos({ ...binding, origin: "https://127.0.0.1" }, "portal", ["SKU-1"], request)).rejects.toThrow("MEDIA_ORIGIN");
    expect(request).not.toHaveBeenCalled();
  });

  it("only renders the approved public image origin", () => {
    expect(catalogueImageUrl("https://cdn.shopify.com/photo.png")).toBeTruthy();
    expect(catalogueImageUrl("https://cdn.shopify.com.evil.test/photo.png")).toBeNull();
    expect(catalogueImageUrl("https://user:password@cdn.shopify.com/photo.png")).toBeNull();
  });
});

function mockPhotoRefresh() {
  requireAdmin.mockResolvedValue({ companyId: "portal", id: "admin" });
  vi.stubEnv("PORTAL_COSMO_PRODUCT_MEDIA_JSON", JSON.stringify({ portal: { ...binding, token: "a".repeat(40) } }));
  db.$queryRaw.mockResolvedValue([{ id: "p", sku: "SKU-1", skuMatches: 1 }]);
  db.productCatalogueMedia.upsert.mockResolvedValue({
    companyId: "portal", productId: "p", refreshVersion: 8, cosmoProductItemId: null,
  });
  db.$transaction.mockImplementation((operation) => operation(db));
}

describe("photo refresh", () => {
  it("does not replace the current photo after a transient failure", async () => {
    mockPhotoRefresh();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    expect(await refreshCataloguePhoto("p")).toEqual({ outcome: "FAILED" });
    expect(db.productCatalogueMedia.updateMany).toHaveBeenCalledWith({
      where: { companyId: "portal", productId: "p", refreshVersion: 8, product: { sku: "SKU-1", isActive: true } },
      data: { refreshFailedAt: expect.any(Date) },
    });
  });

  it("does not publish a response when the refresh version no longer matches", async () => {
    mockPhotoRefresh();
    db.productCatalogueMedia.updateMany.mockResolvedValue({ count: 0 });
    vi.stubGlobal("fetch", service({
      items: [{ sku: "SKU-1", status: "MATCHED", truncated: false, candidates: [{
        cosmoProductItemId: "source-product", shopifyProductId: "123", shopifyVariantId: "456",
        imageUrl: "https://cdn.shopify.com/test.jpg", imageAlt: null, sourceUpdatedAt: "2026-11-21T00:00:00Z",
      }] }],
    }));
    expect(await refreshCataloguePhoto("p")).toEqual({ outcome: "STALE" });
    expect(db.productCatalogueMedia.updateMany.mock.calls[0][0].where.refreshVersion).toBe(8);
  });
});
