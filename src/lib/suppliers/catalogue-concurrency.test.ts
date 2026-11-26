import { beforeEach, expect, it, vi } from "vitest";

const { db, auth, audit } = vi.hoisted(() => ({ db: { $transaction: vi.fn() }, auth: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/guards", () => ({ requireSupplier: auth }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: audit }));
vi.mock("@/lib/notifications", () => ({ createUserNotification: vi.fn() }));
vi.mock("./audit", () => ({ writeSupplierAuditLog: audit }));

import { Prisma } from "@/generated/prisma/client";
import type { ProvisionedAppUser } from "@/lib/auth/types";
import { distributeRequirementInTransaction } from "@/lib/requests/distribute-core";
import { updateOwnSupplierProfile } from "./supplier-self";

const supplier = { id: "supplier", name: "Supplier", status: "ACTIVE", supportsAllBrands: false };
const actor = { id: "staff", companyId: "company" } as ProvisionedAppUser;

function fixture() {
  let memberships = [{ brandId: "brand" }];
  let hasRequest = false;
  let head = Promise.resolve();
  const calls: string[] = [];
  const create = vi.fn(async () => { hasRequest = true; });
  db.$transaction.mockImplementation(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let release: (() => void) | undefined;
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        expect(strings.join("?")).toContain("ORDER BY id FOR UPDATE");
        const previous = head;
        head = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        calls.push("lock");
        return [{ id: supplier.id }];
      },
      supplier: {
        findFirst: async () => ({ ...supplier, brands: memberships }),
        findMany: async () => [{ ...supplier, brands: memberships }],
        update: async () => supplier,
      },
      supplierRequest: {
        findMany: async () => hasRequest ? [{ brandId: "brand" }] : [],
        findFirst: async () => null,
        create,
      },
      user: { findMany: async () => [] },
      supplierBrand: {
        deleteMany: async () => { memberships = []; },
        createMany: vi.fn(),
      },
    };
    try {
      return await work(tx as unknown as Prisma.TransactionClient);
    } finally {
      release?.();
    }
  });
  return { calls, create };
}

function distribute() {
  return db.$transaction((tx: Prisma.TransactionClient) => distributeRequirementInTransaction(tx, {
    actor, requirementId: "req", brandId: "brand", brandName: "Brand", mode: "SELECTED",
    items: [{ id: "line", quantityPlanned: "1", product: { id: "product", name: "Item", sku: "SKU", priorityStatus: "NORMAL" } }],
    recipients: [{ id: supplier.id, name: supplier.name, items: [{
      requirementItemId: "line", productId: "product", quantityRequested: new Prisma.Decimal(1),
    }] }],
    responseDeadline: null,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ id: "user", companyId: "company", supplierId: supplier.id });
});

it("rejects brand removal when concurrent request creation wins the lock", async () => {
  const { create, calls } = fixture();
  const [request, removal] = await Promise.allSettled([
    distribute(), updateOwnSupplierProfile({ name: supplier.name, supportsAllBrands: false, brandIds: [] }),
  ]);
  expect(request.status).toBe("fulfilled");
  expect(removal).toMatchObject({ status: "rejected", reason: { code: "BRAND_LOCKED" } });
  expect(create).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(["lock", "lock"]);
});

it("rechecks recipient eligibility when concurrent brand removal wins", async () => {
  const { create, calls } = fixture();
  const removal = updateOwnSupplierProfile({ name: supplier.name, supportsAllBrands: false, brandIds: [] });
  await Promise.resolve();
  const [profile, request] = await Promise.allSettled([removal, distribute()]);
  expect(profile.status).toBe("fulfilled");
  expect(request).toMatchObject({ status: "rejected", reason: { code: "INVALID_SUPPLIER" } });
  expect(create).not.toHaveBeenCalled();
  expect(calls).toEqual(["lock", "lock"]);
});
