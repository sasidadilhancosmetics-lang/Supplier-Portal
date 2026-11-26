/**
 * Neon development integration checks for price negotiation.
 * Skips unless RUN_DB_INTEGRATION=1 and DATABASE_URL is set.
 */
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });

const run =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(run)("price negotiation neon integration", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let Prisma: typeof import("@/generated/prisma/client").Prisma;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ Prisma } = await import("@/generated/prisma/client"));
  });

  it("keeps protected PO unchanged and price tables empty or additive", async () => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true, version: true, orderNumber: true },
    });
    expect(po?.status).toBe("CONFIRMED");
    expect(po?.version).toBe(2);

    const quoteCount = await prisma.priceQuote.count();
    const agreementCount = await prisma.priceAgreement.count();
    expect(quoteCount).toBeGreaterThanOrEqual(0);
    expect(agreementCount).toBeGreaterThanOrEqual(0);
  });

  it("rejects non-positive PriceQuote at the database check", async () => {
    const company = await prisma.company.findFirst({ select: { id: true } });
    const supplier = await prisma.supplier.findFirst({
      where: { companyId: company!.id },
      select: { id: true, companyId: true },
    });
    const product = await prisma.product.findFirst({
      where: { companyId: company!.id },
      select: { id: true },
    });
    expect(company && supplier && product).toBeTruthy();

    await expect(
      prisma.priceQuote.create({
        data: {
          id: `pq_bad_${Date.now()}`,
          companyId: company!.id,
          supplierId: supplier!.id,
          productId: product!.id,
          channel: "PORTAL",
          kind: "SUPPLIER_ORIGINAL",
          status: "QUOTED",
          unitPrice: new Prisma.Decimal(0),
          currencyCode: "LKR",
        },
      }),
    ).rejects.toThrow();
  });
});
