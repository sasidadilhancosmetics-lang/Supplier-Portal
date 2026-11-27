/**
 * Phase D1 UAT fixture — disposable OSF import on Neon development only.
 *
 * Usage:
 *   npx tsx scripts/phase-d1-uat-fixture.ts create
 *   npx tsx scripts/phase-d1-uat-fixture.ts cleanup
 *
 * Prefer attaching to an existing staff company:
 *   $env:D1_UAT_COMPANY_ID='...'; npx tsx scripts/phase-d1-uat-fixture.ts create
 *
 * Does not touch purchase orders or real supplier requests.
 */
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const PRODUCTION_BRANCH_ID = "br-fancy-voice-b33wenqw";
const marker = "d1_uat_fixture";

async function main() {
  const mode = process.argv[2] ?? "create";
  const branchId = process.env.NEON_BRANCH_ID ?? null;
  if (!process.env.DATABASE_URL || branchId === PRODUCTION_BRANCH_ID) {
    throw new Error(
      "Refusing to run: set DATABASE_URL on Neon development (not production).",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    if (mode === "cleanup") {
      const imports = await prisma.osfImport.findMany({
        where: { idempotencyKey: { startsWith: marker } },
        select: { id: true, companyId: true },
      });
      const importIds = imports.map((i) => i.id);
      const companyIds = [...new Set(imports.map((i) => i.companyId))];
      const reqs = await prisma.requirement.findMany({
        where: { osfImportId: { in: importIds } },
        select: { id: true },
      });
      await prisma.osfImportLine.updateMany({
        where: { osfImportId: { in: importIds } },
        data: {
          mappingStatus: "EXCLUDED",
          requirementItemId: null,
          requirementId: null,
          productId: null,
          brandId: null,
        },
      });
      await prisma.requirementItem.deleteMany({
        where: { requirementId: { in: reqs.map((r) => r.id) } },
      });
      await prisma.osfImportLine.deleteMany({
        where: { osfImportId: { in: importIds } },
      });
      await prisma.requirement.deleteMany({
        where: { osfImportId: { in: importIds } },
      });
      await prisma.osfImport.deleteMany({ where: { id: { in: importIds } } });
      await prisma.product.deleteMany({
        where: {
          companyId: { in: companyIds },
          sku: { startsWith: "D1UAT-" },
        },
      });
      await prisma.brand.deleteMany({
        where: {
          companyId: { in: companyIds },
          name: { startsWith: "D1UAT " },
        },
      });
      await prisma.company.deleteMany({
        where: {
          id: { in: companyIds },
          name: { startsWith: "D1UAT Co" },
        },
      });
      console.log(
        JSON.stringify(
          { cleanedImports: importIds.length, companyIds },
          null,
          2,
        ),
      );
      return;
    }

    if (mode !== "create") {
      throw new Error("Usage: create | cleanup");
    }

    const companyIdEnv = process.env.D1_UAT_COMPANY_ID;
    const tag = `${marker}_${Date.now().toString(36)}`;
    let companyId = companyIdEnv;
    let createdCompany = false;

    if (!companyId) {
      const existingStaff = await prisma.user.findFirst({
        where: { role: { in: ["STAFF", "ADMIN"] }, isActive: true },
        select: { companyId: true, email: true },
        orderBy: { createdAt: "asc" },
      });
      if (existingStaff?.companyId) {
        companyId = existingStaff.companyId;
        console.error(
          `Using existing staff company ${companyId} (${existingStaff.email})`,
        );
      } else {
        companyId = `${tag}_co`;
        await prisma.company.create({
          data: { id: companyId, name: `D1UAT Co ${tag}` },
        });
        createdCompany = true;
      }
    }

    const brandId = `${tag}_br`;
    const brandMystery = `D1UAT Mystery ${tag}`;
    await prisma.brand.create({
      data: {
        id: brandId,
        companyId,
        name: `D1UAT Brand ${tag}`,
      },
    });
    const productId = `${tag}_pr`;
    await prisma.product.create({
      data: {
        id: productId,
        companyId,
        brandId,
        name: `D1UAT Product ${tag}`,
        sku: "D1UAT-MATCH",
        isActive: true,
        masterStatus: "PROVISIONAL",
      },
    });

    const importId = `${tag}_imp`;
    await prisma.osfImport.create({
      data: {
        id: importId,
        companyId,
        idempotencyKey: `${marker}-${tag}`,
        payloadHash: randomBytes(32).toString("hex"),
        contractVersion: "cosmo-osf-push.v1",
        status: "NEEDS_REVIEW",
        payload: { fixture: true, tag },
        version: 1,
      },
    });

    const reqId = `${tag}_rq`;
    await prisma.requirement.create({
      data: {
        id: reqId,
        companyId,
        brandId,
        osfImportId: importId,
        status: "DRAFT",
        title: `D1UAT OSF — Brand ${tag}`,
      },
    });
    const itemId = `${tag}_ri`;
    await prisma.requirementItem.create({
      data: {
        id: itemId,
        requirementId: reqId,
        productId,
        quantityPlanned: 10,
        externalLineId: "D1UAT-MATCH",
      },
    });

    await prisma.osfImportLine.createMany({
      data: [
        {
          id: `${tag}_lm`,
          companyId,
          osfImportId: importId,
          sourceIndex: 0,
          lineKey: "D1UAT-MATCH",
          sku: "D1UAT-MATCH",
          descriptionSnapshot: "Matched line",
          cosmoVendorId: "vnd_uat",
          brandNameSnapshot: `D1UAT Brand ${tag}`,
          erp1Priority: "A",
          quantityProposed: 10,
          quantityPlanned: 10,
          mappingStatus: "MATCHED_SKU",
          brandId,
          productId,
          requirementId: reqId,
          requirementItemId: itemId,
          version: 1,
        },
        {
          id: `${tag}_lu`,
          companyId,
          osfImportId: importId,
          sourceIndex: 1,
          lineKey: "D1UAT-UNK",
          sku: "D1UAT-UNK",
          descriptionSnapshot: "Unknown SKU line",
          cosmoVendorId: "vnd_uat",
          brandNameSnapshot: `D1UAT Brand ${tag}`,
          quantityProposed: 4,
          quantityPlanned: 4,
          mappingStatus: "UNKNOWN_SKU",
          brandId,
          version: 1,
        },
        {
          id: `${tag}_lub`,
          companyId,
          osfImportId: importId,
          sourceIndex: 2,
          lineKey: "D1UAT-NOBR",
          sku: "D1UAT-NOBR",
          descriptionSnapshot: "Unknown brand line",
          cosmoVendorId: "vnd_mystery_uat",
          brandNameSnapshot: brandMystery,
          quantityProposed: 2,
          quantityPlanned: 2,
          mappingStatus: "UNKNOWN_BRAND",
          version: 1,
        },
        {
          id: `${tag}_lz`,
          companyId,
          osfImportId: importId,
          sourceIndex: 3,
          lineKey: "D1UAT-ZERO",
          sku: "D1UAT-ZERO",
          descriptionSnapshot: "Zero qty line",
          cosmoVendorId: "vnd_uat",
          brandNameSnapshot: `D1UAT Brand ${tag}`,
          quantityProposed: 0,
          quantityPlanned: 0,
          mappingStatus: "REJECTED_ZERO_QTY",
          brandId,
          version: 1,
        },
      ],
    });

    const po = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: "PO-20261112-E5D42983" },
      select: { status: true },
    });

    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    console.log(
      JSON.stringify(
        {
          importId,
          companyId,
          createdCompany,
          reviewUrl: `${baseUrl}/staff/osf-imports/${importId}`,
          listUrl: `${baseUrl}/staff/osf-imports`,
          protectedPoStatus: po?.status ?? null,
          cleanup: "npx tsx scripts/phase-d1-uat-fixture.ts cleanup",
          note: createdCompany
            ? "Created disposable company — recreate with D1_UAT_COMPANY_ID set to your staff companyId for authenticated UAT."
            : "Attached to staff company — open reviewUrl while authenticated as that company's staff.",
          cases: [
            {
              action: "Open review",
              expect:
                "4 lines visible across expanded brand groups; Confirm All disabled",
            },
            {
              action: "Save qty on matched line",
              expect: "Persists after reload; proposed qty unchanged",
            },
            {
              action: "Link unknown SKU to D1UAT Product",
              expect: "MATCHED_SKU + RequirementItem",
            },
            {
              action: "Resolve unknown brand (confirm affected count)",
              expect: "Snapshots preserved; lines rematched",
            },
            {
              action: "Exclude then restore",
              expect: "Line stays visible as EXCLUDED then restored",
            },
            {
              action: "Search then Reset filters",
              expect: "All 4 lines return",
            },
            {
              action: "Stale tab save",
              expect: "VERSION_CONFLICT / refresh message",
            },
            {
              action: "Include zero-qty line",
              expect:
                "Requires confirm; proposed stays 0; leaves REJECTED_ZERO_QTY",
            },
            {
              action: "Create provisional / create brand",
              expect: "Permission-gated; links/rematches correctly",
            },
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
