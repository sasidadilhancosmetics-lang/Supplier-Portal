import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const { db, requireSupplier, lockSuppliers, lockCompanyCatalogue } = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    supplierCataloguePriceRevision: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
  requireSupplier: vi.fn(),
  lockSuppliers: vi.fn(),
  lockCompanyCatalogue: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/guards", () => ({ requireSupplier }));
vi.mock("@/lib/suppliers/locking", () => ({ lockSuppliers }));
vi.mock("@/lib/osf-imports/catalogue-lock", () => ({ lockCompanyCatalogue }));

import { cataloguePriceInput, getSupplierCatalogueProduct, listSupplierCatalogue, saveCataloguePrice } from "./catalogue";

const input = {
  productId: "product", osfImportId: "import", expectedRevision: 0,
  idempotencyKey: "f6612781-e9a9-4878-894b-d81e1a788b9d", unitPrice: "10.50", moq: null,
};
const product = { importId: "import", productId: "product", sku: "SKU", revision: null, uom: "Each" };

beforeEach(() => {
  vi.resetAllMocks();
  requireSupplier.mockResolvedValue({ id: "actor", companyId: "company", supplierId: "supplier" });
  lockCompanyCatalogue.mockResolvedValue(true);
  lockSuppliers.mockResolvedValue([{ id: "supplier" }]);
  db.$transaction.mockImplementation((operation) => operation(db));
  db.$queryRaw.mockResolvedValue([product]);
});

describe("catalogue visibility and price revisions", () => {
  it("uses one scoped query with the latest confirmation, mapped lines, membership, exclusion and own revision", async () => {
    await listSupplierCatalogue("ABC", 1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const strings = db.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
    const sql = strings.join("?");
    for (const clause of [
      "status = 'CONFIRMED'", '"confirmedAt" IS NOT NULL', 'ORDER BY "confirmedAt" DESC, id DESC',
      '"mappingStatus" = \'MATCHED_SKU\'', '"quantityPlanned" > 0', "p.sku = l.sku", 'p."isActive"',
      'b."companyId" = p."companyId"', '"SupplierBrand"', '"SupplierCatalogueSkuExclusion"',
      'r."supplierId" = ?', 'SELECT DISTINCT',
    ]) expect(sql).toContain(clause);
    expect(db.$queryRaw.mock.calls[0]).toContain("company");
    expect(db.$queryRaw.mock.calls[0]).toContain("supplier");
    expect(sql).not.toContain("supportsAllBrands");
  });

  it("never reads history or writes for inaccessible products", async () => {
    db.$queryRaw.mockResolvedValue([{ importId: "import", productId: null }]);
    expect(await getSupplierCatalogueProduct("product")).toBeNull();
    expect(await saveCataloguePrice(input)).toEqual({ status: "UNAVAILABLE" });
    expect(db.supplierCataloguePriceRevision.findMany).not.toHaveBeenCalled();
    expect(db.supplierCataloguePriceRevision.create).not.toHaveBeenCalled();
  });

  it("rejects an OSF rollover or stale price revision", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ ...product, importId: "new" }])
      .mockResolvedValueOnce([{ ...product, revision: 2 }]);
    expect(await saveCataloguePrice(input)).toEqual({ status: "CONFLICT" });
    expect(await saveCataloguePrice(input)).toEqual({ status: "CONFLICT" });
    expect(db.supplierCataloguePriceRevision.create).not.toHaveBeenCalled();
  });

  it("checks eligibility only after the company and supplier locks", async () => {
    lockCompanyCatalogue.mockImplementationOnce(async () => {
      expect(lockSuppliers).not.toHaveBeenCalled();
      expect(db.$queryRaw).not.toHaveBeenCalled();
      db.$queryRaw.mockResolvedValue([{ ...product, importId: "replacement" }]);
      return true;
    });

    expect(await saveCataloguePrice(input)).toEqual({ status: "CONFLICT" });
    expect(lockCompanyCatalogue).toHaveBeenCalledWith(db, "company", "save-price");
    expect(lockSuppliers).toHaveBeenCalledWith(db, "company", ["supplier"]);
    expect(db.supplierCataloguePriceRevision.create).not.toHaveBeenCalled();
  });

  it("serializes concurrent saves, appends once and replays the identical request", async () => {
    let queue = Promise.resolve();
    db.$transaction.mockImplementation((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const result = queue.then(() => operation(db as unknown as Prisma.TransactionClient));
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
    db.supplierCataloguePriceRevision.create.mockImplementation(({ data }) => {
      db.$queryRaw.mockResolvedValue([{ ...product, revision: data.revision }]);
      db.supplierCataloguePriceRevision.findFirst.mockImplementation(({ where }) =>
        where.idempotencyKey === data.idempotencyKey ? data : null,
      );
      return data;
    });
    const secondKey = "750c07dd-2100-48a8-a395-c38a93c0ff6e";
    const outcomes = await Promise.all([saveCataloguePrice(input), saveCataloguePrice({ ...input, idempotencyKey: secondKey, unitPrice: "12" })]);
    expect(outcomes).toEqual([{ status: "SAVED", revision: 1, unitPrice: "10.5", moq: null }, { status: "CONFLICT" }]);
    expect(await saveCataloguePrice(input)).toEqual(outcomes[0]);
    expect(await saveCataloguePrice({ ...input, unitPrice: "12" })).toEqual({ status: "CONFLICT" });
    expect(db.supplierCataloguePriceRevision.create).toHaveBeenCalledTimes(1);
    expect(db.supplierCataloguePriceRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: "company", supplierId: "supplier", productId: "product", actorUserId: "actor", unitOfMeasure: "Each",
    }) });
  });

  it.each(["0", "0.00", "1.001", "3e2", "10000000000000000"])("rejects price %s", (unitPrice) => {
    expect(cataloguePriceInput.safeParse({ ...input, unitPrice }).success).toBe(false);
  });

  it("rejects excess precision on save before opening a transaction", async () => {
    expect(await saveCataloguePrice({ ...input, unitPrice: "140.567" })).toEqual({ status: "INVALID" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
