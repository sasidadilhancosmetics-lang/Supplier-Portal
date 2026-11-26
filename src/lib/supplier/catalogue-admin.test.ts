import { beforeEach, expect, it, vi } from "vitest";

const { db, requireAdmin, audit, lockSuppliers } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    product: { findFirst: vi.fn() },
    supplierCatalogueSkuExclusion: { createMany: vi.fn(), deleteMany: vi.fn() },
  },
  requireAdmin: vi.fn(),
  audit: vi.fn(),
  lockSuppliers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/guards", () => ({ requireAdmin }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: audit }));
vi.mock("@/lib/suppliers/locking", () => ({ lockSuppliers }));

import { setCatalogueExclusion } from "./catalogue-admin";

beforeEach(() => {
  vi.resetAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin", companyId: "company" });
  lockSuppliers.mockResolvedValue([{ id: "supplier" }]);
  db.$transaction.mockImplementation((operation) => operation(db));
  db.product.findFirst.mockResolvedValue({ id: "product" });
});

it("does not mutate an exclusion for a supplier or product outside the company", async () => {
  lockSuppliers.mockResolvedValueOnce([]);
  expect(await setCatalogueExclusion("foreign", "product", true)).toBe(false);
  db.product.findFirst.mockResolvedValueOnce(null);
  expect(await setCatalogueExclusion("supplier", "foreign", true)).toBe(false);
  expect(db.supplierCatalogueSkuExclusion.createMany).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

it("hides and restores a product by tenant-scoped exclusion only", async () => {
  db.supplierCatalogueSkuExclusion.createMany.mockResolvedValue({ count: 1 });
  db.supplierCatalogueSkuExclusion.deleteMany.mockResolvedValue({ count: 1 });
  const scope = { companyId: "company", supplierId: "supplier", productId: "product" };
  expect(await setCatalogueExclusion("supplier", "product", true)).toBe(true);
  expect(await setCatalogueExclusion("supplier", "product", false)).toBe(true);
  expect(db.supplierCatalogueSkuExclusion.createMany).toHaveBeenCalledWith({ data: { ...scope, createdByUserId: "admin" }, skipDuplicates: true });
  expect(db.supplierCatalogueSkuExclusion.deleteMany).toHaveBeenCalledWith({ where: scope });
  expect(audit).toHaveBeenCalledTimes(2);
});
